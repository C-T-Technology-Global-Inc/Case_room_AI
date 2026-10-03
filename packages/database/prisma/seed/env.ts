// Imported first by the seed entry point so DATABASE_URL is available before
// the Prisma client module is evaluated.
import path from "node:path";
import { config } from "dotenv";

config({
  path: [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")],
  quiet: true,
});
