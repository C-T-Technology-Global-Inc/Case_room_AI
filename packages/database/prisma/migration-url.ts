/**
 * The app connects with node-postgres; migrations run through Prisma's own
 * driver, which reads SSL options differently. Prisma ignores
 * `sslmode=verify-full` and would connect without TLS, and it names the CA file
 * `sslcert` instead of `sslrootcert`. This translates node-postgres SSL options
 * so one DATABASE_URL, such as a hosted database's with its CA certificate,
 * serves both. Other URLs are returned unchanged.
 *
 * Lives under prisma/ because the migration image copies only this folder and
 * prisma.config.ts.
 */
export function migrationUrl(databaseUrl: string): string {
  const queryStart = databaseUrl.indexOf("?");
  if (queryStart === -1) return databaseUrl;

  const params = new URLSearchParams(databaseUrl.slice(queryStart + 1));
  const mode = params.get("sslmode");
  if (mode !== "verify-full" && mode !== "verify-ca") return databaseUrl;

  // Prisma: encrypt, and verify the server certificate.
  params.set("sslmode", "require");
  params.set("sslaccept", "strict");
  const ca = params.get("sslrootcert");
  params.delete("sslrootcert");
  if (ca) params.set("sslcert", ca);
  return `${databaseUrl.slice(0, queryStart)}?${params.toString()}`;
}
