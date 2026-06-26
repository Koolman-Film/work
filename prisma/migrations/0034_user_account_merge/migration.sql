-- Self-serve admin↔employee account merge: single-use token + dismissal flag.
ALTER TABLE "User" ADD COLUMN "mergeToken" TEXT;
ALTER TABLE "User" ADD COLUMN "mergeTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mergePromptDismissedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_mergeToken_key" ON "User"("mergeToken");
