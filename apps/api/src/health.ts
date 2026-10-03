import { Hono } from "hono";

/**
 * `/health` is a public liveness probe, so its body is a constant.
 *
 * It used to name the agent runtime, the sandbox provider, which integrations were present,
 * the job and realtime backends and the deployed revision - to anyone who asked, through the
 * public edge. That is a map of the deployment, and on a public repository the revision also
 * says exactly which commit is running.
 *
 * Operators still need those details, so they moved to `/internal/health` on the API port.
 * A reverse proxy adds forwarding headers, so a request carrying them arrived through the
 * public edge rather than from the host itself, and gets nothing.
 */
export function healthRoutes(details: () => Record<string, unknown>) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/internal/health", (c) => {
    if (c.req.header("x-forwarded-for") || c.req.header("forwarded")) return c.notFound();
    return c.json({ ok: true, ...details() });
  });
  return app;
}
