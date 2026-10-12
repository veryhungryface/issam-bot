-- The weekly credit limit, in Korean won.
--
-- Two columns rather than one table: the deployment holds the figure everyone gets, and an
-- account may carry its own. Null on the account means "use the deployment's", which is why
-- it is nullable instead of defaulted — a default would freeze every existing account at
-- whatever the figure was on the day this ran, and raising the deployment limit later would
-- not reach any of them.
ALTER TABLE "deployment_settings" ADD COLUMN "weeklyCreditKrw" INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE "user" ADD COLUMN "weeklyCreditKrw" INTEGER;
