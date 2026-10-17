import { invalidProviderResponse } from "./provider-error";

/** Never turn malformed or truncated provider arguments into an executable empty call. */
export function parseToolArguments(value: unknown): Record<string, unknown> {
  let args = value;
  if (typeof value === "string") {
    try {
      args = JSON.parse(value || "{}");
    } catch {
      throw invalidProviderResponse("Tool arguments are not valid JSON");
    }
  }
  if (args === null || typeof args !== "object" || Array.isArray(args))
    throw invalidProviderResponse("Tool arguments must be a JSON object");
  return args as Record<string, unknown>;
}

export function validateToolCalls(
  calls: readonly { id: string; name: string; args: unknown }[],
): void {
  const ids = new Set<string>();
  for (const call of calls) {
    if (
      !call ||
      typeof call.id !== "string" ||
      !call.id ||
      typeof call.name !== "string" ||
      !call.name ||
      ids.has(call.id)
    )
      throw invalidProviderResponse(
        "Tool calls have missing or duplicate identities",
      );
    ids.add(call.id);
    if (typeof call.args === "string")
      throw invalidProviderResponse("Parsed tool arguments must be an object");
    parseToolArguments(call.args);
  }
}

export function validateMaxSteps(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("maxSteps must be a positive safe integer");
}
