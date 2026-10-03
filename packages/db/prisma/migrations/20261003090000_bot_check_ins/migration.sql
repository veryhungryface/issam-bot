-- Per-bot controls for unprompted check-ins. Default on: this deployment serves
-- one user who asked for the behaviour, and silence is the normal outcome anyway.
ALTER TABLE "bots" ADD COLUMN "checkInsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "bots" ADD COLUMN "checkInQuietStartHour" INTEGER NOT NULL DEFAULT 22;
ALTER TABLE "bots" ADD COLUMN "checkInQuietEndHour" INTEGER NOT NULL DEFAULT 8;

-- Check-ins reuse the routine scheduler, but the user should not find five
-- mystery routines in their list, so the system row is tagged and filtered out.
ALTER TABLE "routines" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'user';
CREATE INDEX "routines_botId_kind_idx" ON "routines"("botId", "kind");
