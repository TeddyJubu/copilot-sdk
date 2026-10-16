/** Explicit model-facing output; the application's raw tool result stays separate. */
export type ToolOutputPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string | Uint8Array; mediaType: string }
  | { type: "image"; url: string }
  | { type: "image"; fileId: string; provider: "openai" };

export interface ToolModelOutput {
  type: "content";
  content: ToolOutputPart[];
}

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Validate and make bytes JSON-safe before persistence/transport. Never downloads URLs. */
export function normalizeToolOutput(value: unknown): ToolModelOutput {
  const output = value as ToolModelOutput;
  if (
    output?.type !== "content" ||
    !Array.isArray(output.content) ||
    !output.content.length
  ) {
    throw new Error("Tool model output must contain a nonempty content array");
  }
  return {
    type: "content",
    content: output.content.map((part) => {
      if (part?.type === "text" && typeof part.text === "string")
        return { type: "text", text: part.text };
      if (part?.type !== "image")
        throw new Error("Unsupported tool output content type");
      const sources = ["data", "url", "fileId"].filter((key) => key in part);
      if (sources.length !== 1)
        throw new Error(
          "Tool image requires exactly one of data, url, or fileId",
        );
      if ("fileId" in part) {
        if (
          part.provider !== "openai" ||
          typeof part.fileId !== "string" ||
          !part.fileId.trim()
        )
          throw new Error(
            "Tool image file references must name the openai provider and fileId",
          );
        return { type: "image", fileId: part.fileId, provider: "openai" };
      }
      if ("url" in part) {
        let url: URL;
        try {
          url = new URL(part.url);
        } catch {
          throw new Error("Invalid tool image URL");
        }
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error(
            "Tool image URL must use HTTP(S) without credentials",
          );
        return { type: "image", url: url.href };
      }
      if (!("data" in part) || !imageTypes.has(part.mediaType))
        throw new Error("Unsupported tool image media type");
      let data =
        part.data instanceof Uint8Array
          ? Buffer.from(part.data).toString("base64")
          : part.data;
      if (typeof data !== "string")
        throw new Error("Tool image data must be base64 or bytes");
      if (data.startsWith("data:")) {
        const match = /^data:([^;,]+);base64,(.+)$/.exec(data);
        if (!match || match[1] !== part.mediaType)
          throw new Error(
            "Tool image data URL media type does not match mediaType",
          );
        data = match[2];
      }
      if (
        !data.length ||
        data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
      )
        throw new Error("Invalid tool image base64 data");
      if (Buffer.byteLength(data, "base64") > 20 * 1024 * 1024)
        throw new Error("Tool image exceeds 20 MiB");
      if (Buffer.from(data, "base64").toString("base64") !== data)
        throw new Error("Invalid tool image base64 data");
      // Keep transport allocations bounded; providers may impose smaller per-request limits.
      return { type: "image", data, mediaType: part.mediaType };
    }),
  };
}

export function resolveToolOutput(
  result: unknown,
  mapped?: ToolModelOutput,
): ToolModelOutput | undefined {
  if (mapped !== undefined) return normalizeToolOutput(mapped);
  const content = (result as { _aiContent?: unknown } | null)?._aiContent;
  return content !== undefined
    ? normalizeToolOutput({ type: "content", content })
    : undefined;
}

export function toolOutputForProvider(
  value: unknown,
  provider: "responses" | "anthropic" | "unsupported",
): Array<Record<string, unknown>> {
  const output = normalizeToolOutput(value);
  return output.content.map((part) => {
    if (part.type === "text")
      return {
        type: provider === "responses" ? "input_text" : "text",
        text: part.text,
      };
    if (provider === "unsupported")
      throw new Error(
        "Image tool results require OpenAI Responses or Anthropic; this endpoint is not supported",
      );
    if ("fileId" in part) {
      if (provider !== "responses")
        throw new Error(
          "OpenAI image file references cannot be sent to another provider",
        );
      return { type: "input_image", file_id: part.fileId, detail: "auto" };
    }
    if (provider === "responses")
      return {
        type: "input_image",
        image_url:
          "url" in part
            ? part.url
            : `data:${part.mediaType};base64,${part.data}`,
        detail: "auto",
      };
    return {
      type: "image",
      source:
        "url" in part
          ? { type: "url", url: part.url }
          : { type: "base64", media_type: part.mediaType, data: part.data },
    };
  });
}

export function textToolOutput(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  return toolOutputForProvider(value, "unsupported")
    .map((part) => part.text)
    .join("\n");
}
