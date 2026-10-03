-- AlterTable
ALTER TABLE "Decision" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE "Decision_number_seq";

-- CreateIndex
CREATE UNIQUE INDEX "Decision_caseRoomId_number_key" ON "Decision"("caseRoomId", "number");

