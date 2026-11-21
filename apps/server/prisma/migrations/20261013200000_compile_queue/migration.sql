-- AlterTable
ALTER TABLE "CompileJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "workerId" VARCHAR(100);

-- CreateTable
CREATE TABLE "CompileWorker" (
    "id" VARCHAR(100) NOT NULL,
    "hostname" VARCHAR(255) NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompileWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompileJob_status_createdAt_idx" ON "CompileJob"("status", "createdAt");


-- One active (queued or running) compile per project, across app instances.
-- Older duplicates (should not exist) are closed first.
UPDATE "CompileJob" j SET "status" = 'error', "errorMessage" = 'Superseded', "finishedAt" = CURRENT_TIMESTAMP
WHERE j."status" IN ('queued', 'running')
  AND EXISTS (
    SELECT 1 FROM "CompileJob" k
    WHERE k."projectId" = j."projectId" AND k."status" IN ('queued', 'running') AND k."createdAt" > j."createdAt"
  );
CREATE UNIQUE INDEX "CompileJob_one_active_per_project" ON "CompileJob"("projectId") WHERE "status" IN ('queued', 'running');
