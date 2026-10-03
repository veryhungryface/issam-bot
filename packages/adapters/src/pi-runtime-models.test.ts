import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildModelConnectPlaintext, modelCredentialDto } from "./model-connect.js";
import { resolveModelAuth } from "./pi-oauth.js";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "./pi-openai-compatible-provider.js";
import { modelsForRequest } from "./pi-runtime.js";

function requestModel(id: string, baseUrl: string): Pick<AgentRunRequest, "model"> {
  return { model: { provider: OPENAI_COMPATIBLE_PROVIDER_ID, id, baseUrl } };
}

/**
 * These exercise connect/normalize/runtime wiring with a local model server, which is the
 * deployment owner's case. The gate that decides who may reach a private endpoint at all is
 * covered in openai-compatible-url.test.ts.
 */
beforeAll(() => {
  process.env.RAKAZO_SHARE_PRIVATE_MODELS = "1";
});

afterAll(() => {
  delete process.env.RAKAZO_SHARE_PRIVATE_MODELS;
});

describe("request model catalogs", () => {
  it("isolates concurrent OpenAI-compatible endpoint registrations", () => {
    const first = modelsForRequest(
      requestModel("first-model", "http://127.0.0.1:8001/v1"),
      OPENAI_COMPATIBLE_PROVIDER_ID,
    );
    const second = modelsForRequest(
      requestModel("second-model", "http://127.0.0.1:8002/v1"),
      OPENAI_COMPATIBLE_PROVIDER_ID,
    );

    expect(first).not.toBe(second);
    expect(first.getModel(OPENAI_COMPATIBLE_PROVIDER_ID, "first-model")?.baseUrl).toBe(
      "http://127.0.0.1:8001/v1",
    );
    expect(first.getModel(OPENAI_COMPATIBLE_PROVIDER_ID, "second-model")).toBeUndefined();
    expect(second.getModel(OPENAI_COMPATIBLE_PROVIDER_ID, "second-model")?.baseUrl).toBe(
      "http://127.0.0.1:8002/v1",
    );
  });
});

it.each([true, false, undefined])(
  "keeps saved capability %s consistent between metadata and runtime",
  async (reasoning) => {
    const plaintext = buildModelConnectPlaintext({
      provider: OPENAI_COMPATIBLE_PROVIDER_ID,
      modelId: "same-model",
      baseUrl: "http://localhost:8000/v1",
      reasoning,
    });
    const auth = await resolveModelAuth(plaintext, OPENAI_COMPATIBLE_PROVIDER_ID);
    expect(auth.secret.kind).toBe("openai_compatible");
    if (auth.secret.kind !== "openai_compatible") throw new Error("Wrong credential type");
    const models = modelsForRequest(
      {
        model: {
          provider: OPENAI_COMPATIBLE_PROVIDER_ID,
          id: "same-model",
          baseUrl: auth.secret.baseUrl,
          reasoning: auth.secret.reasoning,
        },
      },
      OPENAI_COMPATIBLE_PROVIDER_ID,
    );
    const model = models.getModel(OPENAI_COMPATIBLE_PROVIDER_ID, "same-model")!;
    const credential = modelCredentialDto(
      {
        id: "cred",
        provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        label: "Server",
        isDefault: true,
        defaultModel: "same-model",
      },
      plaintext,
    );
    expect(model.reasoning).toBe(reasoning ?? false);
    expect(credential.thinkingLevels).toEqual(getSupportedThinkingLevels(model));
  },
);
