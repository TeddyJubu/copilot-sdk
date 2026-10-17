import { MediaAPIError } from "../../core/image";

export interface OpenAIMediaProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  fetch?: typeof globalThis.fetch;
}
export function invalidMedia(message: string): never {
  throw new MediaAPIError(message, "invalid_input");
}

/** Single, bounded request; no retries of billable session/image creation. */
export async function postMedia(
  config: OpenAIMediaProviderOptions,
  path: string,
  body: string | FormData,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    safetyIdentifier?: string;
    maxResponseBytes?: number;
  } = {},
) {
  options.signal?.throwIfAborted();
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600_000)
    invalidMedia("timeoutMs must be between 1 and 600000");
  const key = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) invalidMedia("An OpenAI API key is required on the server");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (typeof body === "string") headers["Content-Type"] = "application/json";
  if (config.organization) headers["OpenAI-Organization"] = config.organization;
  if (config.project) headers["OpenAI-Project"] = config.project;
  if (options.safetyIdentifier)
    headers["OpenAI-Safety-Identifier"] = options.safetyIdentifier;
  const controller = new AbortController();
  const relay = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Media request timed out", "TimeoutError"),
      ),
    timeout,
  );
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const perform = async () => {
    let response: Response;
    try {
      response = await (config.fetch ?? globalThis.fetch)(
        `${(config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}${path}`,
        {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
          redirect: "error",
        },
      );
    } catch {
      controller.signal.throwIfAborted();
      throw new MediaAPIError(
        "OpenAI media connection failed",
        "network_error",
      );
    }
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (controller.signal.aborted || !response.ok) {
      void response.body?.cancel().catch(() => {});
      controller.signal.throwIfAborted();
      throw new MediaAPIError(
        `OpenAI media returned HTTP ${response.status}`,
        "http_error",
        response.status,
        requestId,
      );
    }
    const limit = options.maxResponseBytes ?? 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) {
      void response.body?.cancel().catch(() => {});
      throw new MediaAPIError(
        "Media response exceeds size limit",
        "invalid_response",
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw new MediaAPIError("Media response is empty", "invalid_response");
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          cancel();
          throw new MediaAPIError(
            "Media response exceeds size limit",
            "invalid_response",
          );
        }
        chunks.push(value);
      }
    } catch (error) {
      controller.signal.throwIfAborted();
      if (error instanceof MediaAPIError) throw error;
      throw new MediaAPIError(
        "Media response could not be read",
        "network_error",
      );
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    controller.signal.throwIfAborted();
    return {
      text: Buffer.concat(chunks).toString("utf8"),
      status: response.status,
      requestId,
    };
  };
  try {
    return await Promise.race([perform(), aborted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relay);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
export function mediaJSON(text: string): Record<string, any> {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    /* sanitized below */
  }
  throw new MediaAPIError(
    "Media API returned invalid JSON",
    "invalid_response",
  );
}
