import type { DecisionImage } from "../../core/decisions";
import { DecisionAPIError } from "../../core/decisions";
import {
  assertDecisionKeys,
  decisionInputError,
} from "../../core/decision-validation";

export function unsupportedDecision(message: string): never {
  throw new DecisionAPIError(message, "unsupported_option");
}
export function prepareDecisionImages(
  images: readonly DecisionImage[],
  provider: string,
): Array<{
  url: string;
  base64?: string;
  mediaType?: string;
  detail?: string;
}> {
  if (provider === "openrouter" && images.length)
    unsupportedDecision(
      "OpenRouter's native Decisions schema does not support image inputs",
    );
  if (provider === "cloudflare" && images.length > 4)
    decisionInputError("Cloudflare Decisions supports at most four images");
  if (provider === "openai" && images.length > 128)
    decisionInputError("OpenAI Decisions supports at most 128 images");
  let total = 0;
  return images.map((image) => {
    assertDecisionKeys(
      image as unknown as Record<string, unknown>,
      ["data", "mediaType", "detail"],
      "Decision image",
    );
    if (image.detail !== undefined) {
      if (provider !== "openai")
        unsupportedDecision(
          "Image detail is only supported by OpenAI Decisions",
        );
      if (!["auto", "low", "high", "original"].includes(image.detail))
        decisionInputError("Invalid image detail");
    }
    const data = Buffer.from(image.data);
    const signature = data.subarray(0, 12).toString("latin1");
    const mediaType = signature.startsWith("\x89PNG\r\n\x1a\n")
      ? "image/png"
      : data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        ? "image/jpeg"
        : signature.startsWith("RIFF") && signature.slice(8) === "WEBP"
          ? "image/webp"
          : /^GIF8[79]a/.test(signature)
            ? "image/gif"
            : undefined;
    if (
      !mediaType ||
      (image.mediaType !== undefined && image.mediaType !== mediaType)
    )
      decisionInputError(
        "Decision image bytes must match a supported encoded image format",
      );
    if (
      provider === "typesafe" &&
      !["image/png", "image/jpeg"].includes(mediaType)
    )
      unsupportedDecision("Jev images must be PNG or JPEG");
    if (provider === "cloudflare" && mediaType === "image/gif")
      unsupportedDecision("Cloudflare Decisions does not accept GIF images");
    const limit =
      provider === "cloudflare" ? 4 : provider === "typesafe" ? 16 : 20;
    if (data.length > limit * 1024 * 1024)
      decisionInputError("Decision image exceeds this provider's file limit");
    total += data.length;
    if (provider === "cloudflare" && total > 8 * 1024 * 1024)
      decisionInputError("Cloudflare Decisions images exceed 8 MiB total");
    const base64 = data.toString("base64");
    return {
      url: `data:${mediaType};base64,${base64}`,
      base64,
      mediaType,
      detail: image.detail,
    };
  });
}
