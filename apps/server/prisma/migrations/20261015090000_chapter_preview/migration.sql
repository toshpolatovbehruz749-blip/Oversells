-- AlterTable
ALTER TABLE "CompileJob" ADD COLUMN     "previewFile" VARCHAR(255),
ADD COLUMN     "previewLine" INTEGER,
ADD COLUMN     "previewLabel" VARCHAR(300);
