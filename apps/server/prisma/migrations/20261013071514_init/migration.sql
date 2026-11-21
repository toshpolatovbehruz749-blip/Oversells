-- CreateEnum
CREATE TYPE "Compiler" AS ENUM ('pdflatex', 'xelatex', 'lualatex');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('text', 'binary');

-- CreateEnum
CREATE TYPE "CompileStatus" AS ENUM ('queued', 'running', 'success', 'failed', 'timeout', 'error');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "compiler" "Compiler" NOT NULL DEFAULT 'xelatex',
    "mainFile" VARCHAR(255) NOT NULL DEFAULT 'main.tex',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "kind" "FileKind" NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "storageKey" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompileJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "CompileStatus" NOT NULL DEFAULT 'queued',
    "compiler" "Compiler" NOT NULL,
    "mainFile" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "exitCode" INTEGER,
    "entries" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "pdfKey" VARCHAR(300),
    "logKey" VARCHAR(300),

    CONSTRAINT "CompileJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFile_projectId_path_key" ON "ProjectFile"("projectId", "path");

-- CreateIndex
CREATE INDEX "CompileJob_projectId_createdAt_idx" ON "CompileJob"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompileJob" ADD CONSTRAINT "CompileJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
