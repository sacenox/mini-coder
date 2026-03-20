interface ParsedModelString {
  provider: string;
  modelId: string;
}

/**
 * Split a "<provider>/<model-id>" string into its two parts.
 * When there is no slash, provider is the full string and modelId is "".
 */
export function parseModelString(modelString: string): ParsedModelString {
  const slashIdx = modelString.indexOf("/");
  if (slashIdx === -1) return { provider: modelString, modelId: "" };
  return {
    provider: modelString.slice(0, slashIdx),
    modelId: modelString.slice(slashIdx + 1),
  };
}

function isZenProvider(provider: string): boolean {
  return provider === "zen";
}

export function isAnthropicModelFamily(modelString: string): boolean {
  const { provider, modelId } = parseModelString(modelString);
  return (
    provider === "anthropic" ||
    (isZenProvider(provider) && modelId.startsWith("claude-"))
  );
}

export function isGeminiModelFamily(modelString: string): boolean {
  const { provider, modelId } = parseModelString(modelString);
  return (
    (provider === "google" || isZenProvider(provider)) &&
    modelId.startsWith("gemini-")
  );
}

export function isOpenAIGPTModelFamily(modelString: string): boolean {
  const { provider, modelId } = parseModelString(modelString);
  return (
    (provider === "openai" || isZenProvider(provider)) &&
    modelId.startsWith("gpt-")
  );
}

export function isOpenAIReasoningModelFamily(modelString: string): boolean {
  const { provider, modelId } = parseModelString(modelString);
  return (
    (provider === "openai" || isZenProvider(provider)) &&
    (modelId.startsWith("o") || modelId.startsWith("gpt-5"))
  );
}

export function isZenOpenAICompatibleChatModel(modelString: string): boolean {
  const { provider, modelId } = parseModelString(modelString);
  if (!isZenProvider(provider)) return false;
  return (
    !modelId.startsWith("gpt-") &&
    !modelId.startsWith("gemini-") &&
    !modelId.startsWith("claude-")
  );
}

type ZenBackend = "anthropic" | "openai" | "google" | "compat";

export function getZenBackend(modelId: string): ZenBackend {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("gpt-")) return "openai";
  if (modelId.startsWith("gemini-")) return "google";
  return "compat";
}
