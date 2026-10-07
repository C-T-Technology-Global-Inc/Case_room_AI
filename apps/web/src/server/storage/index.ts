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
  /** The object, or null when it does not exist. Any other failure throws StorageUnavailableError. */
  get(key: string): Promise<Buffer | null>;
}

/** Storage could not be reached or refused access (not "file missing"): callers report 503, not 404. */
export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

/** True for "the object does not exist" from the local filesystem or an S3-compatible service. */
export function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, name, $metadata } = error as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return code === "ENOENT" || name === "NoSuchKey" || name === "NotFound" || $metadata?.httpStatusCode === 404;
}

class LocalFileStorage implements FileStorage {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const target = path.resolve(/*turbopackIgnore: true*/ this.root, key);
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
    const target = this.resolve(key);
    try {
      return await readFile(target);
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw new StorageUnavailableError("Could not read the file from local storage.", { cause: error });
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
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Some S3-compatible services reject this header; set S3_SERVER_SIDE_ENCRYPTION="" for them.
        ...(serverSideEncryption() ? { ServerSideEncryption: serverSideEncryption() } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw new StorageUnavailableError("Could not read the file from object storage.", { cause: error });
    }
  }
}

function serverSideEncryption(): "AES256" | "aws:kms" | undefined {
  const value = process.env.S3_SERVER_SIDE_ENCRYPTION ?? "AES256";
  return value === "AES256" || value === "aws:kms" ? value : undefined;
}

let storage: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (!storage) {
    const bucket = process.env.S3_BUCKET?.trim();
    // STORAGE_DIR points local storage at a persistent volume (containers); defaults to ./.storage.
    // Runtime data, not code: the ignore comments keep build tracing from copying the project (and stored files) into the server output.
    const directory = process.env.STORAGE_DIR?.trim() || path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".storage");
    storage = bucket ? new S3FileStorage(bucket) : new LocalFileStorage(path.resolve(/*turbopackIgnore: true*/ directory));
  }
  return storage;
}

export { LocalFileStorage };
