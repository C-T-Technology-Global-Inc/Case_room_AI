import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Object storage for original uploaded files. Local disk by default; any
 * S3-compatible service (AWS S3, MinIO, R2) when S3_BUCKET is configured.
 * Only extracted text is used by the AI layer; originals are kept for audit.
 */
export interface FileStorage {
  readonly kind: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

class LocalFileStorage implements FileStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    // Must stay strictly inside the root (a prefix check would accept sibling folders such as ".storage-other").
    const relative = path.relative(path.resolve(this.root), target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid storage key");
    return target;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }
}

class S3FileStorage implements FileStorage {
  readonly kind = "s3" as const;
  constructor(private readonly bucket: string) {}

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: "AES256" }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
}

let storage: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (!storage) {
    const bucket = process.env.S3_BUCKET?.trim();
    storage = bucket ? new S3FileStorage(bucket) : new LocalFileStorage(path.resolve(process.cwd(), ".storage"));
  }
  return storage;
}
