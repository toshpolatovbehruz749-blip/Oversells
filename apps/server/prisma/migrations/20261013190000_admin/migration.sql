-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "maxProjects" INTEGER,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user',
ADD COLUMN     "storageQuotaBytes" BIGINT;

