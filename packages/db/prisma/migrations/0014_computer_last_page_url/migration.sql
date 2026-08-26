-- Remember the page a Browserbase session was on so the next session can reopen it.
ALTER TABLE "computers" ADD COLUMN "lastPageUrl" TEXT;
