import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMissingObject, LocalFileStorage, StorageUnavailableError, type FileStorage } from "./index";

describe("file storage errors", () => {
  it("returns null only when the file does not exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ccr-storage-"));
    const storage: FileStorage = new LocalFileStorage(root);
    await storage.put("cases/c1/report.txt", Buffer.from("synthetic"), "text/plain");
    expect((await storage.get("cases/c1/report.txt"))?.toString()).toBe("synthetic");
    expect(await storage.get("cases/c1/missing.txt")).toBeNull();
  });

  it("reports an unreadable file as storage unavailable, not missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ccr-storage-"));
    await mkdir(path.join(root, "cases"), { recursive: true });
    // A directory where a file is expected: reading it fails with EISDIR.
    await mkdir(path.join(root, "cases", "folder.txt"));
    const storage = new LocalFileStorage(root);
    await expect(storage.get("cases/folder.txt")).rejects.toBeInstanceOf(StorageUnavailableError);

    if (process.getuid?.() !== 0) {
      const locked = path.join(root, "cases", "locked.txt");
      await writeFile(locked, "synthetic");
      await chmod(locked, 0o000);
      await expect(storage.get("cases/locked.txt")).rejects.toBeInstanceOf(StorageUnavailableError);
    }
  });

  it("recognizes S3 'not found' errors and nothing else", () => {
    expect(isMissingObject({ name: "NoSuchKey" })).toBe(true);
    expect(isMissingObject({ name: "NotFound", $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(isMissingObject({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } })).toBe(false);
    expect(isMissingObject({ name: "InternalError", $metadata: { httpStatusCode: 500 } })).toBe(false);
    expect(isMissingObject(new Error("socket hang up"))).toBe(false);
  });

  it("gives up on a storage operation that hangs, instead of holding the request forever", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ccr-storage-"));
    await mkdir(path.join(root, "cases"), { recursive: true });
    // Named pipes nobody opens from the other side: opening one blocks indefinitely, like a hung mount.
    const writePipe = path.join(root, "cases", "hung-write.pdf");
    const readPipe = path.join(root, "cases", "hung-read.pdf");
    execFileSync("mkfifo", [writePipe, readPipe]);
    const storage: FileStorage = new LocalFileStorage(root, 300);
    try {
      const started = Date.now();
      await expect(storage.put("cases/hung-write.pdf", Buffer.from("synthetic"), "application/pdf")).rejects.toThrow(/did not respond within/);
      await expect(storage.get("cases/hung-read.pdf")).rejects.toThrow(/did not respond within/);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      // Release the blocked opens so no worker thread stays stuck after the test.
      closeSync(openSync(writePipe, constants.O_RDONLY | constants.O_NONBLOCK));
      closeSync(openSync(readPipe, constants.O_WRONLY | constants.O_NONBLOCK));
    }
  });

  it("reports write failures as storage unavailable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ccr-storage-"));
    if (process.getuid?.() === 0) return;
    await chmod(root, 0o500);
    const storage: FileStorage = new LocalFileStorage(root);
    try {
      await expect(storage.put("cases/c1/report.pdf", Buffer.from("synthetic"), "application/pdf")).rejects.toBeInstanceOf(StorageUnavailableError);
    } finally {
      await chmod(root, 0o700);
    }
  });
});
