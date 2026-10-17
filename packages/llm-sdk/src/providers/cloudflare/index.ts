import { nativeDecisionModel } from "../decisions/model";
import type { DecisionProviderOptions } from "../decisions/http";
import { decisionInputError } from "../../core/decision-validation";
export interface CloudflareDecisionProviderOptions extends DecisionProviderOptions {
  /** Defaults to CLOUDFLARE_ACCOUNT_ID. apiKey defaults to CLOUDFLARE_AUTH_TOKEN. */
  accountId?: string;
}
/** Native Workers AI REST endpoint, not a Cloudflare AI Gateway chat route. */
export function cloudflareDecision(
  modelId:
    | "@cf/cloudflare/clef"
    | "@cf/cloudflare/clef-flash" = "@cf/cloudflare/clef",
  options: CloudflareDecisionProviderOptions = {},
) {
  if (!["@cf/cloudflare/clef", "@cf/cloudflare/clef-flash"].includes(modelId))
    decisionInputError("Unsupported Cloudflare Decisions model");
  const accountId = options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId || !/^[a-fA-F0-9]{32}$/.test(accountId))
    decisionInputError(
      "Cloudflare Decisions requires a 32-character account ID",
    );
  return nativeDecisionModel(modelId, {
    ...options,
    provider: "cloudflare",
    keyEnv: "CLOUDFLARE_AUTH_TOKEN",
    defaultBaseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
    path: `/${modelId}`,
    bodyModel: modelId.slice("@cf/cloudflare/".length),
  });
}
