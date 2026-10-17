-- Phase 3: Yjs document updates, versions, comments, shared-with-me.

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('auto', 'named', 'restore');

-- CreateTable
CREATE TABLE "SharedProjectAccess" (
    "userId" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedProjectAccess_pkey" PRIMARY KEY ("userId","shareLinkId")
);

-- CreateTable
CREATE TABLE "DocUpdate" (
    "id" BIGSERIAL NOT NULL,
    "fileId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "snapshot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "VersionKind" NOT NULL,
    "name" VARCHAR(200),
    "createdById" TEXT,
    "contentKey" VARCHAR(300) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "anchorStart" BYTEA,
    "anchorEnd" BYTEA,
    "quote" VARCHAR(500),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedProjectAccess_userId_lastOpenedAt_idx" ON "SharedProjectAccess"("userId", "lastOpenedAt");

-- CreateIndex
CREATE INDEX "DocUpdate_fileId_id_idx" ON "DocUpdate"("fileId", "id");

-- CreateIndex
CREATE INDEX "Version_projectId_createdAt_idx" ON "Version"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_projectId_fileId_idx" ON "Comment"("projectId", "fileId");

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- AddForeignKey
ALTER TABLE "SharedProjectAccess" ADD CONSTRAINT "SharedProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedProjectAccess" ADD CONSTRAINT "SharedProjectAccess_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedProjectAccess" ADD CONSTRAINT "SharedProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocUpdate" ADD CONSTRAINT "DocUpdate_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

