-- The deployment owner's emergency stop. While agentsPausedAt is set no run starts and
-- routines skip their slot; turning it on also cancelled whatever was active at the time.
ALTER TABLE "deployment_settings" ADD COLUMN "agentsPausedAt" TIMESTAMP(3);
ALTER TABLE "deployment_settings" ADD COLUMN "agentsPausedBy" TEXT;
