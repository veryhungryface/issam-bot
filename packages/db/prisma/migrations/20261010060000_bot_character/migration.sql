-- Which character a bot wears. Nullable on purpose: null means "whatever suits it", and
-- the renderer derives a body and a face from the bot's id, so every existing bot already
-- has one and nothing has to be backfilled.
ALTER TABLE "bots" ADD COLUMN "avatarBody" INTEGER;
ALTER TABLE "bots" ADD COLUMN "avatarFace" INTEGER;
ALTER TABLE "bots" ADD COLUMN "avatarAccessory" INTEGER;
