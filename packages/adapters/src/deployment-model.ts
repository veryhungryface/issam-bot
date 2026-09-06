/**
 * The deployment-wide model default: which provider a run falls back to when no user
 * credential applies, and the key for that provider.
 *
 * Vendor env names and model ids live here, in the adapter layer, not in core.
 */
export function resolveDeploymentModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.PI_DEFAULT_PROVIDER?.trim() || "openrouter";
  // A row per provider that ships a deployment key. A third one adds a row here, not a
  // branch at each call site — and an unknown provider gets no key rather than another
  // vendor's, which a ternary on one provider would not give.
  const keys: Record<string, string | undefined> = {
    openrouter: env.OPENROUTER_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
    qwen: env.QWEN_API_KEY,
  };
  const models: Record<string, string> = {
    openrouter: "deepseek/deepseek-v4-flash-0731",
    anthropic: "claude-sonnet-5",
    openai: env.OPENAI_MODEL_ID?.trim() || "gpt-5.2",
    qwen: env.QWEN_MODEL_ID?.trim() || "Qwen/Qwen3.6-35B-A3B-FP8",
  };
  return {
    provider,
    model: env.PI_DEFAULT_MODEL?.trim() || models[provider] || models.openrouter!,
    key: keys[provider],
  };
}
