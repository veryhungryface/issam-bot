-- One Browserbase session's billable time, synced from the provider API.
CREATE TABLE "browser_session_usage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "botId" TEXT,
    "sessionId" TEXT NOT NULL,
    "region" TEXT,
    "status" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "browser_session_usage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "browser_session_usage_sessionId_key" ON "browser_session_usage"("sessionId");
CREATE INDEX "browser_session_usage_workspaceId_startedAt_idx" ON "browser_session_usage"("workspaceId", "startedAt");
ALTER TABLE "browser_session_usage" ENABLE ROW LEVEL SECURITY;
