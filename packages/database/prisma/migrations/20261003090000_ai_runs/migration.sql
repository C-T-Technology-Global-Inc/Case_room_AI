-- CreateEnum
CREATE TYPE "AIRunStatus" AS ENUM ('RESERVED', 'SUCCEEDED', 'FAILED', 'RELEASED');

-- CreateTable
CREATE TABLE "AIRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "identityId" TEXT,
    "task" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "status" "AIRunStatus" NOT NULL DEFAULT 'RESERVED',
    "provider" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AIRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIRun_organizationId_createdAt_idx" ON "AIRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIRun_createdAt_idx" ON "AIRun"("createdAt");

-- AddForeignKey
ALTER TABLE "AIRun" ADD CONSTRAINT "AIRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

