-- Sign-in accounts become `Identity`; `User` becomes a membership of one
-- organization. Existing users keep their password: each gets an identity
-- with the same id, email and password hash.

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- Backfill: one identity per existing user (emails were globally unique).
INSERT INTO "Identity" ("id", "email", "name", "passwordHash", "createdAt")
SELECT "id", "email", "name", "passwordHash", "createdAt" FROM "User";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "identityId" TEXT;
UPDATE "User" SET "identityId" = "id";
ALTER TABLE "User" ALTER COLUMN "identityId" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "passwordHash";

-- DropIndex: an email may now appear once per organization.
DROP INDEX "User_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "Identity_email_key" ON "Identity"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_identityId_organizationId_key" ON "User"("identityId", "organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
