import { DecisionAPIError, type DecisionOptions } from "../../core/decisions";
import {
  decisionInputError,
  decisionResponseError,
} from "../../core/decision-validation";

export interface DecisionProviderOptions {
  apiKey?: string;
  /** API root, not a chat endpoint. Defaults depend on the provider. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

/** Bounded, abortable JSON transport. Error bodies are deliberately not echoed. */
export async function postDecision(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: DecisionOptions,
  fetchFn: typeof globalThis.fetch,
  maxBytes: number,
): Promise<{ value: unknown; status: number; requestId?: string }> {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes)
    decisionInputError("Decision request exceeds the provider's byte limit");
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const relay = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Decision request timed out", "TimeoutError"),
      ),
    options.timeoutMs ?? 60_000,
  );
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const perform = async () => {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers,
        body: encoded,
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      controller.signal.throwIfAborted();
      throw new DecisionAPIError(
        "Decision request failed before receiving a response",
        "network_error",
      );
    }
    const requestId =
      response.headers.get("x-request-id") ??
      response.headers.get("cf-ray") ??
      undefined;
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      controller.signal.throwIfAborted();
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new DecisionAPIError(
        `Decision API returned HTTP ${response.status}`,
        "http_error",
        response.status,
        requestId,
      );
    }
    if (!response.body)
      decisionResponseError("Decision API returned an empty body");
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) {
          cancel();
          decisionResponseError("Decision API response exceeds 8 MiB");
        }
        chunks.push(value);
      }
    } catch (error) {
      controller.signal.throwIfAborted();
      if (error instanceof DecisionAPIError) throw error;
      throw new DecisionAPIError(
        "Decision response could not be read",
        "network_error",
        response.status,
        requestId,
      );
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    controller.signal.throwIfAborted();
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      decisionResponseError("Decision API did not return valid JSON");
    }
    return { value, status: response.status, requestId };
  };
  try {
    return await Promise.race([perform(), aborted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relay);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
