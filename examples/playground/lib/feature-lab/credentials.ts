import type { ApiKeys } from "../types";
import type { LabProvider } from "./catalog";

/** Reuse the dashboard's key storage and send only the chosen provider's key. */
export function featureHeaders(
  keys: ApiKeys,
  provider: LabProvider,
): Record<string, string> {
  const key = keys[provider]?.trim();
  if (!key) return {};
  return {
    "x-api-key": key,
    ...(provider === "cloudflare" && {
      "x-cloudflare-account-id": keys.cloudflareAccountId?.trim() ?? "",
    }),
  };
}
export function hasFeatureKey(keys: ApiKeys, provider: LabProvider) {
  return (
    !!keys[provider]?.trim() &&
    (provider !== "cloudflare" ||
      /^[a-fA-F0-9]{32}$/.test(keys.cloudflareAccountId?.trim() ?? ""))
  );
}
