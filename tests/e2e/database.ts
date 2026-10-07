/**
 * The end-to-end tests erase and re-seed their database. They only run against
 * E2E_DATABASE_URL, whose database name must end in `_e2e` and which must not
 * be the application or integration-test database.
 */
function target(value: string) {
  const parsed = new URL(value);
  const host = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ? "localhost" : parsed.hostname.toLowerCase();
  return `${host}:${parsed.port || "5432"}/${decodeURIComponent(parsed.pathname.replace(/^\//, ""))}`;
}

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("Set E2E_DATABASE_URL (a separate database whose name ends in _e2e) to run end-to-end tests.");
  if (!target(url).endsWith("_e2e")) throw new Error("E2E_DATABASE_URL must point to a database whose name ends in _e2e: the tests erase it.");
  for (const other of ["DATABASE_URL", "TEST_DATABASE_URL"] as const) {
    const value = process.env[other];
    if (value && target(value) === target(url)) throw new Error(`E2E_DATABASE_URL points to the same database as ${other}.`);
  }
  return url;
}
