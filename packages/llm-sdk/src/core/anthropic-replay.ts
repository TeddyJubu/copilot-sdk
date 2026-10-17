import type { ProviderMetadata } from "./openai-responses";

// Retain only Messages API content needed for signed-thinking continuation.
// Usage, request headers, IDs and other raw response diagnostics are never copied.
export function anthropicReplay(
  content: unknown,
): ProviderMetadata | undefined {
  if (
    !Array.isArray(content) ||
    !content.some(
      (b) => b?.type === "thinking" || b?.type === "redacted_thinking",
    )
  )
    return undefined;
  const blocks = content.flatMap((block): Record<string, unknown>[] => {
    if (
      block?.type === "thinking" &&
      typeof block.thinking === "string" &&
      typeof block.signature === "string"
    )
      return [
        {
          type: "thinking",
          thinking: block.thinking,
          signature: block.signature,
        },
      ];
    if (block?.type === "redacted_thinking" && typeof block.data === "string")
      return [{ type: "redacted_thinking", data: block.data }];
    if (block?.type === "text" && typeof block.text === "string")
      return [{ type: "text", text: block.text }];
    if (
      block?.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    )
      return [
        {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        },
      ];
    return [];
  });
  return { anthropic: { content: blocks } };
}

export function anthropicReplayContent(
  metadata: ProviderMetadata | undefined,
): Record<string, unknown>[] | undefined {
  const state = metadata?.anthropic as { content?: unknown } | undefined;
  return (
    anthropicReplay(state?.content)?.anthropic as
      | { content?: Record<string, unknown>[] }
      | undefined
  )?.content;
}

/** Assemble content by index, including the signature delta that text-only consumers skip. */
export function collectAnthropicContent(blocks: any[], event: any): void {
  if (event.type === "content_block_start")
    blocks[event.index] = { ...event.content_block };
  const block = blocks[event.index];
  if (event.type !== "content_block_delta" || !block) return;
  const delta = event.delta;
  if (delta.type === "thinking_delta")
    block.thinking = (block.thinking ?? "") + delta.thinking;
  else if (delta.type === "signature_delta")
    block.signature = (block.signature ?? "") + delta.signature;
  else if (delta.type === "text_delta")
    block.text = (block.text ?? "") + delta.text;
  else if (delta.type === "input_json_delta") {
    block.partialInput = (block.partialInput ?? "") + delta.partial_json;
    try {
      block.input = JSON.parse(block.partialInput);
    } catch {
      /* incomplete delta */
    }
  }
}
