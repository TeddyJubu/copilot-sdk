import {
  MediaAPIError,
  type ImageFile,
  type ImageModel,
  type ImageOptions,
} from "../../core/image";
import {
  invalidMedia,
  mediaJSON,
  postMedia,
  type OpenAIMediaProviderOptions,
} from "./media-http";

export interface OpenAIImageOptions {
  quality?: "auto" | "low" | "medium" | "high" | "xhigh" | "max";
  background?: "auto" | "opaque" | "transparent";
  outputFormat?: "png" | "jpeg" | "webp";
  outputCompression?: number;
  moderation?: "auto" | "low";
  inputFidelity?: "high" | "low";
  safetyIdentifier?: string;
}
const mimes = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;
function imageFormat(data: Uint8Array): string | undefined {
  if (
    Buffer.from(data.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (
    Buffer.from(data.subarray(0, 4)).toString() === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString() === "WEBP"
  )
    return "image/webp";
}
async function fileBlob(file: ImageFile, mask = false): Promise<Blob> {
  if (
    !file ||
    !Object.values(mimes).includes(file.mediaType) ||
    (mask && file.mediaType !== "image/png")
  )
    invalidMedia("Images must be PNG, JPEG or WebP; masks must be PNG");
  const size =
    file.data instanceof Blob ? file.data.size : file.data?.byteLength;
  if (!size || size >= 50_000_000)
    invalidMedia("Each input image must be smaller than 50 MB");
  const bytes =
    file.data instanceof Blob
      ? new Uint8Array(await file.data.arrayBuffer())
      : file.data instanceof Uint8Array
        ? file.data
        : file.data instanceof ArrayBuffer
          ? new Uint8Array(file.data)
          : invalidMedia("Image data must be bytes or a Blob");
  if (imageFormat(bytes) !== file.mediaType)
    invalidMedia("Image bytes do not match the media type");
  return new Blob([new Uint8Array(bytes)], { type: file.mediaType });
}
function optionsFor(model: string, options: ImageOptions): OpenAIImageOptions {
  const allowed = [
    "quality",
    "background",
    "outputFormat",
    "outputCompression",
    "moderation",
    "inputFidelity",
    "safetyIdentifier",
  ];
  for (const [provider, value] of Object.entries(
    options.providerOptions ?? {},
  )) {
    if (
      provider !== "openai" ||
      !value ||
      typeof value !== "object" ||
      Object.keys(value).some((k) => !allowed.includes(k))
    )
      throw new MediaAPIError(
        "Unsupported image provider option",
        "unsupported_option",
      );
  }
  const o = (options.providerOptions?.openai ?? {}) as OpenAIImageOptions;
  for (const [key, values] of Object.entries({
    quality: ["auto", "low", "medium", "high", "xhigh", "max"],
    background: ["auto", "opaque", "transparent"],
    outputFormat: ["png", "jpeg", "webp"],
    moderation: ["auto", "low"],
    inputFidelity: ["high", "low"],
  })) {
    const value = o[key as keyof OpenAIImageOptions];
    if (value !== undefined && !values.includes(value as string))
      invalidMedia(`Invalid image ${key}`);
  }
  if (
    (o.quality === "xhigh" || o.quality === "max") &&
    !model.startsWith("gpt-image-2.5")
  )
    invalidMedia("xhigh/max quality requires a GPT Image 2.5 model");
  if (o.background === "transparent" && o.outputFormat === "jpeg")
    invalidMedia("JPEG does not support transparency");
  if (
    o.outputCompression !== undefined &&
    (!Number.isInteger(o.outputCompression) ||
      o.outputCompression < 0 ||
      o.outputCompression > 100 ||
      !["jpeg", "webp"].includes(o.outputFormat ?? "png"))
  )
    invalidMedia("Compression must be 0–100 and requires JPEG or WebP");
  if (o.inputFidelity !== undefined && !options.images)
    invalidMedia("inputFidelity requires image inputs");
  if (o.moderation !== undefined && options.images)
    throw new MediaAPIError(
      "moderation is supported for generation only",
      "unsupported_option",
    );
  if (
    o.safetyIdentifier !== undefined &&
    (typeof o.safetyIdentifier !== "string" ||
      !o.safetyIdentifier.length ||
      o.safetyIdentifier.length > 128)
  )
    invalidMedia("safetyIdentifier must contain 1–128 characters");
  return o;
}

/** Server-side Images API generation/editing. Does not change chat or Responses models. */
export function openaiImage(
  modelId = "gpt-image-2.5-flare",
  config: OpenAIMediaProviderOptions = {},
): ImageModel {
  if (!/^(gpt-image-|chatgpt-image-)/.test(modelId))
    invalidMedia(
      "Use a GPT Image model; retired DALL-E models are not supported",
    );
  return {
    provider: "openai",
    modelId,
    async doGenerate(options) {
      options.signal?.throwIfAborted();
      if (
        typeof options.prompt !== "string" ||
        !options.prompt.trim() ||
        options.prompt.length > 32_000
      )
        invalidMedia("Image prompt must contain 1–32000 characters");
      const n = options.n ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > 10)
        invalidMedia("n must be an integer from 1 to 10");
      if (options.size !== undefined && options.size !== "auto") {
        const match = /^(\d+)x(\d+)$/.exec(options.size);
        if (!match) invalidMedia("Image size must be auto or WIDTHxHEIGHT");
        const w = Number(match[1]),
          h = Number(match[2]);
        if (modelId.startsWith("gpt-image-2")) {
          if (
            w % 16 ||
            h % 16 ||
            w > 3840 ||
            h > 3840 ||
            w / h > 3 ||
            h / w > 3 ||
            w * h < 655_360 ||
            w * h > 8_294_400
          )
            invalidMedia(
              "Image size exceeds GPT Image dimensions or pixel limits",
            );
        } else if (
          !["1024x1024", "1536x1024", "1024x1536"].includes(options.size)
        )
          invalidMedia("This model requires a standard GPT Image size");
      }
      if (
        options.images &&
        (!Array.isArray(options.images) ||
          !options.images.length ||
          options.images.length > 16)
      )
        invalidMedia("Editing requires 1–16 input images");
      if (options.mask && !options.images)
        invalidMedia("A mask requires image inputs");
      const o = optionsFor(modelId, options);
      const format = o.outputFormat ?? "png";
      const fields = {
        model: modelId,
        prompt: options.prompt,
        n,
        size: options.size,
        quality: o.quality,
        background: o.background,
        output_format: format,
        output_compression: o.outputCompression,
        moderation: o.moderation,
        input_fidelity: o.inputFidelity,
        safety_identifier: o.safetyIdentifier,
      };
      let body: FormData | string = JSON.stringify(fields);
      if (options.images) {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields))
          if (value !== undefined) form.set(key, String(value));
        let total = 0;
        for (const [i, input] of options.images.entries()) {
          const blob = await fileBlob(input);
          total += blob.size;
          if (total > 100_000_000)
            invalidMedia("Total image input exceeds the SDK's 100 MB limit");
          form.append(
            "image[]",
            blob,
            `image-${i}.${input.mediaType.split("/")[1]}`,
          );
        }
        if (options.mask) {
          const mask = await fileBlob(options.mask, true);
          total += mask.size;
          if (total > 100_000_000)
            invalidMedia("Total image input exceeds the SDK's 100 MB limit");
          form.set("mask", mask, "mask.png");
        }
        body = form;
      }
      const response = await postMedia(
        config,
        options.images ? "/images/edits" : "/images/generations",
        body,
        { ...options, maxResponseBytes: 128 * 1024 * 1024 },
      );
      const data = mediaJSON(response.text);
      if (!Array.isArray(data.data) || data.data.length !== n)
        throw new MediaAPIError(
          "Images API returned an unexpected image count",
          "invalid_response",
        );
      const images = data.data.map((item: Record<string, unknown>) => {
        const encoded = item?.b64_json;
        if (
          typeof encoded !== "string" ||
          !encoded.length ||
          encoded.length % 4 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        )
          throw new MediaAPIError(
            "Images API returned invalid base64",
            "invalid_response",
          );
        const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
        if (imageFormat(bytes) !== mimes[format])
          throw new MediaAPIError(
            "Images API returned an unexpected image format",
            "invalid_response",
          );
        return {
          uint8Array: bytes,
          get base64() {
            return Buffer.from(bytes).toString("base64");
          },
          mediaType: mimes[format],
          ...(typeof item.revised_prompt === "string"
            ? { revisedPrompt: item.revised_prompt }
            : {}),
        };
      });
      return {
        image: images[0],
        images,
        usage: data.usage,
        response: {
          provider: "openai",
          modelId,
          status: response.status,
          requestId: response.requestId,
        },
        providerMetadata: {
          created: data.created,
          size: data.size,
          quality: data.quality,
          background: data.background,
        },
      };
    },
  };
}
