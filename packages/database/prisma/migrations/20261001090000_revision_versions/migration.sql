-- AlterTable
ALTER TABLE "CaseBrief" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

