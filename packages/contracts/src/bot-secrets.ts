import { z } from "zod";

export const BotSecretName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

const SecretHeaderName = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,120}$/)
  .refine(
    (name) =>
      !/^(host|connection|content-length|content-type|transfer-encoding|te|trailer|upgrade|cookie|origin|referer|accept|proxy-.*|sec-.*|.*forwarded.*)$/i.test(
        name,
      ),
    "Unsupported credential header",
  );

export const BotSecretAuth = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bearer") }),
  z.object({ type: z.literal("header"), name: SecretHeaderName }),
  z.object({
    type: z.literal("basic"),
    username: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^:\r\n]+$/),
  }),
  // A sign-in form the bot fills in its own browser. These credentials are never
  // attached to outbound HTTP requests, so secret_request must refuse them.
  z.object({ type: z.literal("browser_login") }),
]);

/** One input on a sign-in form the bot asks the user to fill. */
export const BrowserLoginField = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(120),
  /** Masked in the sheet and never echoed back to the bot. */
  masked: z.boolean().default(false),
  /** Optional CSS selector the bot observed; the server still verifies the origin. */
  selector: z.string().max(200).optional(),
  autocomplete: z.enum(["username", "current-password", "one-time-code", "email"]).optional(),
});
export type BrowserLoginField = z.infer<typeof BrowserLoginField>;

export const BROWSER_LOGIN_MAX_FIELDS = 4;
export const BROWSER_LOGIN_MAX_VALUE_LENGTH = 512;

export const BotSecretDestination = z.object({
  name: BotSecretName,
  origin: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === "/"
        );
      } catch {
        return false;
      }
    }, "Expected an HTTPS origin without a path, credentials, query, or fragment"),
  auth: BotSecretAuth,
});
export type BotSecretDestination = z.infer<typeof BotSecretDestination>;

/** Written atomically with the protected value, distinct from action approval. */
export const BotSecretSubmission = z.object({ credentialSaved: BotSecretDestination });

export const SecretHttpRequest = z
  .object({
    name: BotSecretName,
    url: z.string().max(8192),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).default("GET"),
    body: z.string().max(100_000).optional(),
    contentType: z
      .enum(["application/json", "application/x-www-form-urlencoded", "text/plain"])
      .default("application/json"),
  })
  .refine(
    (request) => request.body === undefined || !["GET", "HEAD"].includes(request.method),
    "This method cannot have a body",
  );
