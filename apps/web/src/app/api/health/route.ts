export const dynamic = "force-dynamic";

/** Liveness: the process is up and serving requests. Never touches the database. */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
