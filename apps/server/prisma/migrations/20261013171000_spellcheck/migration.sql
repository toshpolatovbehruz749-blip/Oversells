-- Phase 4: spell-check language per project, personal dictionaries.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "spellLanguage" VARCHAR(10) NOT NULL DEFAULT 'uz-latn';

-- CreateTable
CREATE TABLE "UserWord" (
    "userId" TEXT NOT NULL,
    "word" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWord_pkey" PRIMARY KEY ("userId","word")
);

-- AddForeignKey
ALTER TABLE "UserWord" ADD CONSTRAINT "UserWord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

