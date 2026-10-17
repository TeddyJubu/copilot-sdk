export interface ImageFile {
  data: Uint8Array | ArrayBuffer | Blob;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}
export interface ImageOptions {
  prompt: string;
  n?: number;
  size?: "auto" | `${number}x${number}`;
  /** Supplying images switches to image editing. URLs are never fetched implicitly. */
  images?: ImageFile[];
  mask?: ImageFile;
  signal?: AbortSignal;
  timeoutMs?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
}
export interface GeneratedImage {
  uint8Array: Uint8Array;
  readonly base64: string;
  mediaType: string;
  revisedPrompt?: string;
}
export interface ImageResult {
  image: GeneratedImage;
  images: GeneratedImage[];
  usage?: Record<string, unknown>;
  response: {
    provider: string;
    modelId: string;
    requestId?: string;
    status: number;
  };
  providerMetadata?: Record<string, unknown>;
}
export interface ImageModel {
  readonly provider: string;
  readonly modelId: string;
  doGenerate(options: ImageOptions): Promise<ImageResult>;
}
export async function generateImage({
  model,
  ...options
}: ImageOptions & { model: ImageModel }): Promise<ImageResult> {
  options.signal?.throwIfAborted();
  if (typeof options.prompt !== "string" || !options.prompt.trim())
    throw new MediaAPIError("Image prompt must not be empty", "invalid_input");
  const result = await model.doGenerate(options);
  options.signal?.throwIfAborted();
  if (
    !result.images?.length ||
    result.images.some(
      (image) =>
        !(image.uint8Array instanceof Uint8Array) || !image.uint8Array.length,
    )
  )
    throw new MediaAPIError(
      "Image provider returned empty images",
      "invalid_response",
    );
  return result;
}

const marker = Symbol.for("@yourgpt/llm-sdk/MediaAPIError");
/** Errors from image and realtime setup requests. Provider bodies and credentials are not retained. */
export class MediaAPIError extends Error {
  readonly [marker] = true;
  readonly name = "MediaAPIError";
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[marker] === true
    );
  }
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "unsupported_option"
      | "invalid_response"
      | "http_error"
      | "network_error",
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
