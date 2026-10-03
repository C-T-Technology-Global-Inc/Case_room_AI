import { describe, expect, it } from "vitest";
import { PayloadTooLargeError } from "../errors";
import { readFormDataWithLimit } from "./limited-body";

function streamOf(bytes: number, chunk = 64 * 1024) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const size = Math.min(chunk, bytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
  });
}

describe("readFormDataWithLimit", () => {
  it("parses a multipart body under the limit", async () => {
    const form = new FormData();
    form.set("title", "Synthetic report");
    form.set("file", new File(["synthetic text"], "report.txt", { type: "text/plain" }));
    const parsed = await readFormDataWithLimit(new Request("http://test/upload", { method: "POST", body: form }), 1024 * 1024);
    expect(parsed.get("title")).toBe("Synthetic report");
    expect(await (parsed.get("file") as File).text()).toBe("synthetic text");
  });

  it("rejects a declared length over the limit before reading", async () => {
    const request = new Request("http://test/upload", { method: "POST", body: "x".repeat(10), headers: { "content-length": String(50 * 1024 * 1024) } });
    await expect(readFormDataWithLimit(request, 1024)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it("stops reading a chunked body as soon as it passes the limit", async () => {
    const request = new Request("http://test/upload", {
      method: "POST",
      body: streamOf(5 * 1024 * 1024),
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    await expect(readFormDataWithLimit(request, 256 * 1024)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});
