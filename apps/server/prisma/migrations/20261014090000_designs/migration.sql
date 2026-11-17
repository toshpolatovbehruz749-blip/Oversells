-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "designId" VARCHAR(64);

-- AlterTable
ALTER TABLE "CompileJob" ADD COLUMN     "kind" VARCHAR(20) NOT NULL DEFAULT 'project',
ADD COLUMN     "renderKey" VARCHAR(100),
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Design_ownerId_updatedAt_idx" ON "Design"("ownerId", "updatedAt");

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

