import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Commands run from apps/web (npm workspace scripts); the monorepo root is two levels up.
const monorepoRoot = path.resolve(process.cwd(), "../..");
// Share the root .env with Prisma and tests; deployment environment variables take precedence.
const rootEnvPath = path.join(monorepoRoot, ".env");
if (existsSync(rootEnvPath)) process.loadEnvFile(rootEnvPath);

const nextConfig: NextConfig = {
  // Internal packages export TypeScript source and are compiled by Next.
  transpilePackages: ["@ccr/ui", "@ccr/ai", "@ccr/types", "@ccr/database"],
  // Native / heavy server-only packages are loaded from node_modules at runtime.
  serverExternalPackages: ["pg", "@prisma/adapter-pg", "unpdf", "@aws-sdk/client-s3"],
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
