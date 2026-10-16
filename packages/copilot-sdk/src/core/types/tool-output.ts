/** Portable wire contract shared with @yourgpt/llm-sdk ToolModelOutput. */
export type ToolOutputPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string | Uint8Array; mediaType: string }
  | { type: "image"; url: string }
  | { type: "image"; fileId: string; provider: "openai" };
export interface ToolModelOutput {
  type: "content";
  content: ToolOutputPart[];
}

/** Persist byte arrays as base64. The server validates provider/media capabilities. */
export function serializeToolModelOutput(
  output: ToolModelOutput,
): ToolModelOutput {
  if (
    output?.type !== "content" ||
    !Array.isArray(output.content) ||
    !output.content.length
  )
    throw new Error("Tool model output requires a nonempty content array");
  return {
    type: "content",
    content: output.content.map((part) => {
      if (
        part.type === "image" &&
        "data" in part &&
        part.data instanceof Uint8Array
      ) {
        let binary = "";
        for (const byte of part.data) binary += String.fromCharCode(byte);
        return { ...part, data: btoa(binary) };
      }
      return { ...part };
    }),
  };
}

export function resultModelOutput(
  result: unknown,
): ToolModelOutput | undefined {
  const content = (result as { _aiContent?: ToolOutputPart[] } | null)
    ?._aiContent;
  return content?.length
    ? serializeToolModelOutput({ type: "content", content })
    : undefined;
}
