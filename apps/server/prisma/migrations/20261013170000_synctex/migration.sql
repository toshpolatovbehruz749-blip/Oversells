-- Phase 4: keep the SyncTeX file of a compile.

-- AlterTable
ALTER TABLE "CompileJob" ADD COLUMN     "synctexKey" VARCHAR(300);

