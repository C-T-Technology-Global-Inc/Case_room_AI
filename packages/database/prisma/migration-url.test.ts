import { describe, expect, it } from "vitest";
import { migrationUrl } from "./migration-url";

const base = "postgresql://postgres.ref:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";

describe("migration URL", () => {
  it("gives Prisma the equivalent of verify-full with a CA file", () => {
    const url = new URL(migrationUrl(`${base}?sslmode=verify-full&sslrootcert=/certs/supabase-ca.crt`));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("sslaccept")).toBe("strict");
    expect(url.searchParams.get("sslcert")).toBe("/certs/supabase-ca.crt");
    expect(url.searchParams.has("sslrootcert")).toBe(false);
  });

  it("keeps the credentials and host exactly as written", () => {
    expect(migrationUrl(`${base}?sslmode=verify-full`).startsWith(`${base}?`)).toBe(true);
  });

  it("verifies against the system certificates when no CA file is given", () => {
    const url = new URL(migrationUrl(`${base}?sslmode=verify-ca&connect_timeout=10`));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("sslaccept")).toBe("strict");
    expect(url.searchParams.has("sslcert")).toBe(false);
    expect(url.searchParams.get("connect_timeout")).toBe("10");
  });

  it("leaves local and other URLs unchanged", () => {
    for (const url of [
      "postgresql://postgres:postgres@localhost:5432/clinical_case_room",
      `${base}?sslmode=require`,
      `${base}?sslmode=disable`,
    ]) {
      expect(migrationUrl(url)).toBe(url);
    }
  });
});
