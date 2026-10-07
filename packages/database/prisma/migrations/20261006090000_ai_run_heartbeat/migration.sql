-- AlterTable
ALTER TABLE "AIRun" ADD COLUMN     "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "AIRun_status_heartbeatAt_idx" ON "AIRun"("status", "heartbeatAt");

