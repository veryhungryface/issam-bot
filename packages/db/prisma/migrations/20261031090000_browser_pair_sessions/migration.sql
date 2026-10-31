-- CreateTable
CREATE TABLE "browser_pair_sessions" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deviceId" TEXT,
    "ciphertext" TEXT,
    "claimedById" TEXT,
    "spaceId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_pair_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "browser_pair_sessions_deviceId_key" ON "browser_pair_sessions"("deviceId");

-- CreateIndex
CREATE INDEX "browser_pair_sessions_status_expiresAt_idx" ON "browser_pair_sessions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "browser_pair_sessions_createdAt_idx" ON "browser_pair_sessions"("createdAt");

-- AddForeignKey
ALTER TABLE "browser_pair_sessions" ADD CONSTRAINT "browser_pair_sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "browser_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_pair_sessions" ADD CONSTRAINT "browser_pair_sessions_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_pair_sessions" ADD CONSTRAINT "browser_pair_sessions_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
