import { z } from "zod";
import {
  features,
  providers,
  type FeatureId,
  type LabProvider,
  type LabInput,
  type LabResult,
} from "./catalog";
import {
  parametersExample,
  fallbackExample,
  responsesExample,
  toolImagesExample,
  systemPromptExample,
  createLabRuntime,
} from "./examples/chat";
import { decisionsExample } from "./examples/decisions";
import {
  speechExample,
  transcriptionExample,
  imageExample,
  realtimeExample,
} from "./examples/media";

export const keyNames: Record<LabProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  typesafe: "TYPESAFE_AI_API_KEY",
  cloudflare: "CLOUDFLARE_AUTH_TOKEN",
};
const inputSchema = z
  .object({
    provider: z.enum(providers).default("openai"),
    text: z.string().max(2000).optional(),
    streaming: z.boolean().optional(),
    reasoning: z.enum(["default", "none"]).optional(),
    file: z
      .object({
        base64: z.string().min(1).max(6_000_000),
        mediaType: z.string().max(80),
        name: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict();
class LabError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const noStore = { "Cache-Control": "no-store" };
function requestOrigins(request: Request) {
  const url = new URL(request.url);
  const publicUrl = new URL(
    `${url.protocol}//${request.headers.get("host") ?? url.host}`,
  );
  return { url, publicUrl };
}
function allowsServerCredentials(request: Request) {
  const { url, publicUrl } = requestOrigins(request);
  const local = [url.hostname, publicUrl.hostname].every((hostname) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname),
  );
  const origin = request.headers.get("origin");
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PLAYGROUND_FEATURE_LAB === "1" &&
    local &&
    (!origin || origin === publicUrl.origin)
  );
}
export function assertLabAccess(request: Request) {
  const { url, publicUrl } = requestOrigins(request);
  const origin = request.headers.get("origin");
  // The docs deployment proxies /playground to this Next app. Its browser origin
  // can differ from the upstream Host; never use forwarded headers to authorize keys.
  const allowedOrigins = [
    url.origin,
    publicUrl.origin,
    "https://copilot-sdk.yourgpt.ai",
  ];
  if (
    (origin && !allowedOrigins.includes(origin)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new LabError(
      "Open the feature lab on this server to run examples.",
      403,
    );
}
export function labAvailability(request: Request) {
  const local = allowsServerCredentials(request);
  return Object.fromEntries(
    providers.map((provider) => [
      provider,
      {
        configured:
          local &&
          !!process.env[keyNames[provider]]?.trim() &&
          (provider !== "cloudflare" ||
            !!process.env.CLOUDFLARE_ACCOUNT_ID?.trim()),
        requires:
          provider === "cloudflare"
            ? [keyNames[provider], "CLOUDFLARE_ACCOUNT_ID"]
            : [keyNames[provider]],
      },
    ]),
  );
}
export function parseInput(raw: unknown, action: string): LabInput {
  const input = inputSchema.parse(raw);
  const feature = features.find((f) => f.id === action);
  if (!feature || !feature.providers.includes(input.provider))
    throw new LabError(
      "This feature does not support the selected provider.",
      400,
    );
  if (input.file) {
    if (!feature.upload)
      throw new LabError("This example does not accept files.", 400);
    const bytes = Buffer.from(input.file.base64, "base64");
    if (
      bytes.length > 4 * 1024 * 1024 ||
      bytes.toString("base64") !== input.file.base64
    )
      throw new LabError("Use an encoded file up to 4 MiB.", 400);
    const imageTypes = ["image/png", "image/jpeg", "image/webp"];
    const audioTypes = [
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/m4a",
      "audio/webm",
      "audio/ogg",
      "audio/flac",
    ];
    if (
      !(feature.upload === "image" ? imageTypes : audioTypes).includes(
        input.file.mediaType.split(";")[0],
      )
    )
      throw new LabError("Unsupported file format for this example.", 400);
    if (action === "decisions" && input.provider === "openrouter")
      throw new LabError(
        "OpenRouter native Decisions does not support images. Use text or another provider.",
        400,
      );
  }
  return input;
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new LabError("Send a JSON request.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new LabError("Request body is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 7_000_000) {
        await reader.cancel();
        throw new LabError("Request exceeds the 7 MB limit.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LabError("Invalid JSON body.", 400);
  }
}
function credentialsFor(request: Request, provider: LabProvider) {
  const supplied = request.headers.has("x-api-key");
  const local = !supplied && allowsServerCredentials(request);
  const apiKey = (
    supplied
      ? request.headers.get("x-api-key")
      : local
        ? process.env[keyNames[provider]]
        : ""
  )?.trim();
  if (!apiKey || apiKey.length > 16_384)
    throw new LabError(
      "Add your provider key in API keys to run this example.",
      401,
    );
  const accountId =
    provider === "cloudflare"
      ? (local
          ? process.env.CLOUDFLARE_ACCOUNT_ID
          : request.headers.get("x-cloudflare-account-id")
        )?.trim()
      : undefined;
  if (
    provider === "cloudflare" &&
    (!accountId || !/^[a-fA-F0-9]{32}$/.test(accountId))
  )
    throw new LabError("Add a valid Cloudflare account ID in API keys.", 400);
  return { apiKey, accountId };
}
const examples: Partial<
  Record<
    FeatureId,
    (
      input: LabInput,
      key: string,
      signal: AbortSignal,
      accountId?: string,
    ) => Promise<LabResult>
  >
> = {
  parameters: parametersExample,
  fallback: fallbackExample,
  decisions: decisionsExample,
  responses: responsesExample,
  "tool-images": toolImagesExample,
  "system-prompt": systemPromptExample,
  speech: speechExample,
  transcription: transcriptionExample,
  image: imageExample,
};
// Hosted requests use only caller-supplied keys. Server credentials are available
// solely in explicitly enabled local development, never in a production build.
export async function handleLabRequest(
  request: Request,
  action: string,
): Promise<Response> {
  try {
    assertLabAccess(request);
    if (request.method === "GET" && action === "status")
      return Response.json(
        {
          providers: labAvailability(request),
          localCredentials: allowsServerCredentials(request),
        },
        { headers: noStore },
      );
    if (request.method !== "POST")
      throw new LabError("Use POST to run an example.", 405);
    const start = Date.now();
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(180_000),
    ]);
    if (action === "chat") {
      const provider =
        new URL(request.url).searchParams.get("provider") ?? "openai";
      if (provider !== "openai" && provider !== "anthropic")
        throw new LabError("Chat supports OpenAI or Anthropic.", 400);
      const raw = await readBody(request);
      const boundedRequest = new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
        signal,
      });
      const response = await createLabRuntime(
        provider,
        credentialsFor(request, provider).apiKey,
      ).handleRequest(boundedRequest);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const raw = await readBody(request);
    if (action === "realtime") {
      const { sdp } = z
        .object({ sdp: z.string().min(1).max(64_000) })
        .strict()
        .parse(raw);
      return Response.json(
        await realtimeExample(
          sdp,
          credentialsFor(request, "openai").apiKey,
          signal,
        ),
        { headers: noStore },
      );
    }
    const input = parseInput(raw, action);
    const run = examples[action as FeatureId];
    if (!run) throw new LabError("Unknown feature example.", 404);
    const { apiKey, accountId } = credentialsFor(request, input.provider);
    const result = await run(input, apiKey, signal, accountId);
    return Response.json(
      { ...result, durationMs: Date.now() - start },
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof LabError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: noStore },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error:
            "Invalid example options. Check the selected provider, text and file.",
        },
        { status: 400, headers: noStore },
      );
    const e = error as { name?: string; status?: number; code?: string };
    const status =
      typeof e?.status === "number" && e.status >= 400 && e.status <= 599
        ? e.status
        : 502;
    const cancelled =
      request.signal.aborted ||
      ["AbortError", "TimeoutError"].includes(e?.name ?? "");
    // No raw provider messages, request bodies, headers or credentials in responses/logs.
    return Response.json(
      {
        error: cancelled
          ? "Request cancelled or timed out."
          : "The provider request failed. Check model access, credentials, quota and input options.",
        status,
      },
      { status: cancelled ? 408 : status, headers: noStore },
    );
  }
}
