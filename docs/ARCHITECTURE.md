# Browserbase agent architecture

The application is a Rakazo-derived web/API/worker deployment. It deliberately excludes Rakazo's desktop sandbox, local Docker computer, terminal execution, Electron, and Expo clients.

```text
PWA -> API/auth/realtime -> task queue + worker -> Qwen API
       |                                      -> Browserbase Session/CDP
       +-> short-lived Live View authorization -> Browserbase iframe
       +-> managed PostgreSQL / R2
```

## Isolation boundaries

- Every query must include workspace scope; Browserbase Context IDs are stored only against that workspace.
- Browserbase credentials stay in API/worker secret environment, never the browser bundle.
- The worker allows only browser actions. It must reject shell, terminal, arbitrary code, localhost, RFC1918, link-local, and cloud-metadata targets.
- Live View control pauses agent actions through a task-level lease; only one holder may control a session.

## Limits

The product limit is deliberately lower than the Browserbase project limit: three global sessions, one per user, ten minutes per task, three-minute idle expiry, and twenty browser minutes per user per day.
