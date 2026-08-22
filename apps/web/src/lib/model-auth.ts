import type { ModelCatalogEntry } from "@rakazo/contracts";
import { waitForModelOAuthCompletion } from "@rakazo/core";
import { rpc } from "./rpc";

export type { ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
export { cancelModelOAuthAttempt, finishModelOAuthAttempt } from "@rakazo/core";

export function providerHint(entry: ModelCatalogEntry) {
  if (entry.signIn === "device-code") {
    if (entry.provider === "openai-codex") return "ChatGPT Plus/Pro";
    if (entry.provider === "github-copilot") return "Copilot";
    if (entry.provider === "xai") return "SuperGrok / API 키";
    return "로그인";
  }
  if (entry.auth === "oauth") return "건너뛰기 또는 서버 키 사용";
  return "API 키";
}

export async function waitForModelOAuth(loginId: string, signal?: AbortSignal) {
  return waitForModelOAuthCompletion(() => rpc.models.completeOAuth({ loginId }, { signal }), {
    signal,
  });
}
