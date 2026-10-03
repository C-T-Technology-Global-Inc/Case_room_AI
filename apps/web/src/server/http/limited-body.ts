import "server-only";
import { PayloadTooLargeError, ValidationError } from "../errors";

/**
 * Parse a multipart/urlencoded body without ever buffering more than `maxBytes`.
 * `Content-Length` rejects early; the streaming count also covers chunked
 * requests that declare no length.
 */
export async function readFormDataWithLimit(request: Request, maxBytes: number): Promise<FormData> {
  const tooLarge = () => new PayloadTooLargeError(`The upload is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) throw new ValidationError("The request has no body.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new ValidationError("The upload could not be read. Send it as multipart form data.");
  }
}
