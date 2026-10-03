import { describe, expect, it } from "vitest";
import { safePath } from "./safe-path";

describe("safePath", () => {
  it("keeps internal paths with query and hash", () => {
    expect(safePath("/cases/abc?tab=1#message-2")).toBe("/cases/abc?tab=1#message-2");
    expect(safePath("/invite/token%20with%20space")).toBe("/invite/token%20with%20space");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\n/evil.example",
    "/ /evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "evil.example",
    "",
  ])("refuses %j", (value) => {
    expect(safePath(value)).toBe("/dashboard");
  });

  it("refuses non-strings and uses the given fallback", () => {
    expect(safePath(undefined, "/login")).toBe("/login");
    expect(safePath(42)).toBe("/dashboard");
  });
});
