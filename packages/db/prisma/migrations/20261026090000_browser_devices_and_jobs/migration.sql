-- CreateTable
CREATE TABLE "browser_devices" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_jobs" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "browser_devices_secretId_key" ON "browser_devices"("secretId");

-- CreateIndex
CREATE INDEX "browser_devices_spaceId_userId_idx" ON "browser_devices"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "browser_jobs_deviceId_status_createdAt_idx" ON "browser_jobs"("deviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "browser_jobs_spaceId_createdAt_idx" ON "browser_jobs"("spaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "browser_devices" ADD CONSTRAINT "browser_devices_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_devices" ADD CONSTRAINT "browser_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_jobs" ADD CONSTRAINT "browser_jobs_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_jobs" ADD CONSTRAINT "browser_jobs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "browser_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_jobs" ADD CONSTRAINT "browser_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

