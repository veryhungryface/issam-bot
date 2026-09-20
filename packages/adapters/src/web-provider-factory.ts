import type { WebProvider } from "@rakazo/adapter-kit";
import { FakeWebProvider } from "./fake-web.js";
import { fetchImpersonatedWebText } from "./impersonated-fetch.js";
import { KeylessHttpWebProvider } from "./keyless-http-web.js";

/**
 * Resolve the deployment web provider.
 *
 * Pi 0.84 does not expose a provider-neutral callable native-search API we can
 * compose without vendor branches at the tool layer. Default is keyless HTTP so
 * core runs with no hosted search vendor. Inject a custom adapter (or set
 * WEB_PROVIDER=fake in tests) without changing builtin tool names.
 */
export function resolveWebProviderKind(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.WEB_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === "keyless" || raw === "keyless-http") return "keyless-http";
  if (raw === "fake") return "fake";
  return raw;
}

/**
 * Bot walls read a client's TLS fingerprint, so a refused fetch is retried with a real
 * browser's. Deployments can turn the second attempt off with WEB_FETCH_IMPERSONATION=off.
 */
export function impersonationEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  const raw = source.WEB_FETCH_IMPERSONATION?.trim().toLowerCase();
  return !(raw === "off" || raw === "0" || raw === "false");
}

export function createWebProvider(
  kind: string = resolveWebProviderKind(),
  options?: ConstructorParameters<typeof KeylessHttpWebProvider>[0],
): WebProvider {
  switch (kind) {
    case "fake":
      return new FakeWebProvider();
    case "keyless-http":
    case "keyless":
    case "":
      return new KeylessHttpWebProvider({
        ...(impersonationEnabled() ? { impersonatedFetch: fetchImpersonatedWebText } : {}),
        ...options,
      });
    default:
      throw new Error(`Unknown web provider "${kind}"`);
  }
}
