import {
  createRuntime,
  generateText,
  streamText,
  tool,
  type GenerateTextParams,
} from "@yourgpt/llm-sdk";
import { openai, createOpenAI } from "@yourgpt/llm-sdk/openai";
import { anthropic, createAnthropic } from "@yourgpt/llm-sdk/anthropic";
import { createFallbackChain } from "@yourgpt/llm-sdk/fallback";
import { z } from "zod";
import { BLUE_PNG, features, type LabInput, type LabResult } from "../catalog";

// These functions are also small, runnable server-side SDK examples.
const defaults = (id: string) =>
  features.find((f) => f.id === id)!.defaultText!;
async function generate(params: GenerateTextParams, streaming = false) {
  const result = await (streaming ? streamText(params) : generateText(params));
  return {
    text: await result.text,
    response: await result.response,
    usage: await result.usage,
    metadata: await result.providerMetadata,
  };
}
export async function parametersExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  const warnings: string[] = [];
  const result = await generate(
    {
      model: openai("gpt-6-luna", {
        apiKey,
        onWarning: (w) => warnings.push(w),
      }),
      prompt: input.text || defaults("parameters"),
      temperature: 0,
      maxTokens: 1024,
      ...(input.reasoning === "none" && { reasoningEffort: "none" as const }),
      signal,
    },
    input.streaming,
  );
  return {
    feature: "parameters",
    provider: "openai",
    model: "gpt-6-luna",
    text: result.text,
    warnings,
    checks: [
      { label: "Provider returned text", passed: !!result.text.trim() },
      {
        label:
          input.reasoning === "none"
            ? "Explicit none preserves temperature"
            : "Unsupported temperature omitted with warning",
        passed:
          input.reasoning === "none"
            ? warnings.length === 0
            : warnings.some((w) => w.includes("temperature")),
      },
    ],
    details: {
      reasoningEffort: input.reasoning === "none" ? "none" : "provider default",
      streaming: !!input.streaming,
      usage: result.usage,
    },
  };
}
export async function fallbackExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  let retries = 0;
  const fallbacks: Array<{
    from: string;
    to: string;
    status?: number;
    code?: string;
    param?: string;
  }> = [];
  const chain = createFallbackChain({
    models: [
      createOpenAI({ apiKey, parameterPolicy: "passthrough" }).languageModel(
        "gpt-6-luna",
      ),
      createOpenAI({ apiKey }).languageModel("gpt-4o"),
    ],
    retries: 2,
    retryDelay: 0,
    fallbackErrors(error) {
      const e = error as Error & {
        status?: number;
        code?: string;
        param?: string;
      };
      return (
        e.status === 400 &&
        e.param === "temperature" &&
        ["unsupported_value", "unsupported_parameter"].includes(e.code ?? "")
      );
    },
    onRetry: () => {
      retries++;
    },
    onFallback: ({ attemptedModel, nextModel, error }) => {
      const e = error as Error & {
        status?: number;
        code?: string;
        param?: string;
      };
      fallbacks.push({
        from: attemptedModel,
        to: nextModel,
        status: e.status,
        code: e.code,
        param: e.param,
      });
    },
  });
  const request = {
    messages: [
      { id: "demo", role: "user" as const, content: "Reply exactly OK." },
    ],
    config: { temperature: 0 },
    signal,
  };
  let text = "";
  if (input.streaming) {
    for await (const event of chain.stream(request))
      if (event.type === "message:delta") text += event.content;
  } else text = (await chain.complete!(request)).content;
  return {
    feature: "fallback",
    provider: "openai",
    model: "gpt-6-luna → gpt-4o",
    text,
    checks: [
      {
        label: "Exactly one explicit fallback",
        passed: fallbacks.length === 1,
      },
      { label: "No retries of the invalid request", passed: retries === 0 },
      { label: "Fallback model answered", passed: /OK/.test(text) },
    ],
    details: { retries, fallbacks },
  };
}
export async function responsesExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  const model = openai("gpt-6-luna", {
    apiKey,
    api: "responses",
    reasoningEffort: "low",
    responses: { store: false, promptCacheKey: "copilot-feature-lab" },
  });
  const first = await generate(
    {
      model,
      prompt: input.text || defaults("responses"),
      maxTokens: 1024,
      signal,
    },
    input.streaming,
  );
  // Preserve complete output items, including encrypted reasoning and assistant phase.
  const second = await generate(
    {
      model,
      messages: [
        ...first.response.messages,
        {
          role: "user",
          content:
            "What project code was mentioned? If none was mentioned, say so. Answer briefly.",
        },
      ],
      maxTokens: 1024,
      signal,
    },
    input.streaming,
  );
  const state = second.metadata?.openai?.response;
  return {
    feature: "responses",
    provider: "openai",
    model: "gpt-6-luna",
    text: second.text,
    checks: [
      { label: "Responses completed", passed: state?.status === "completed" },
      {
        label: "Conversation retained",
        passed:
          input.text && input.text !== defaults("responses")
            ? !!second.text
            : second.text.includes("ORCHID-742"),
      },
    ],
    details: {
      firstReply: first.text,
      savedMessages: first.response.messages.length,
      store: false,
      outputTypes: state?.output.map((item) => item.type),
      encryptedItems: state?.output.filter(
        (item) => item.type === "reasoning" && item.encrypted_content,
      ).length,
      firstUsage: first.metadata?.openai?.response?.usage,
      secondUsage: state?.usage,
      note: "Cache hits and reasoning items depend on the prompt and provider; neither is required for success.",
    },
  };
}
export async function toolImagesExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  const isOpenAI = input.provider === "openai";
  const modelId = isOpenAI ? "gpt-6-luna" : "claude-sonnet-4-5";
  const model = isOpenAI
    ? openai(modelId, {
        apiKey,
        api: "responses",
        responses: { store: false },
        reasoningEffort: "low",
      })
    : anthropic(modelId, { apiKey });
  let executions = 0;
  const data = input.file?.base64 ?? BLUE_PNG;
  const mediaType = input.file?.mediaType ?? "image/png";
  const result = await generate(
    {
      model,
      signal,
      maxTokens: 1024,
      maxSteps: 3,
      prompt:
        "Call inspect_image exactly once to obtain the sample image. Then describe its dominant color briefly. You cannot know the color before seeing the returned image.",
      tools: {
        inspect_image: tool({
          description: "Return the sample image",
          parameters: z.object({}),
          execute: async () => {
            executions++;
            return { label: "sample" };
          },
          toModelOutput: () => ({
            type: "content",
            content: [{ type: "image", data, mediaType }],
          }),
        }),
      },
    },
    input.streaming,
  );
  const follow = await generate(
    {
      model,
      messages: [
        ...result.response.messages,
        {
          role: "user",
          content:
            "What was the dominant color in the tool image? Answer briefly.",
        },
      ],
      maxTokens: 1024,
      signal,
    },
    input.streaming,
  );
  return {
    feature: "tool-images",
    provider: input.provider,
    model: modelId,
    text: result.text,
    checks: [
      { label: "Tool executed exactly once", passed: executions === 1 },
      {
        label: input.file
          ? "Image response received"
          : "Blue fixture recognized",
        passed: input.file ? !!result.text : /blue/i.test(result.text),
      },
      {
        label: "Saved history replayed",
        passed: input.file ? !!follow.text : /blue/i.test(follow.text),
      },
    ],
    details: {
      executions,
      replayReply: follow.text,
      usage: result.usage,
      replayUsage: follow.usage,
      mediaType,
    },
  };
}
export async function systemPromptExample(
  _input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  const runtime = createRuntime({
    provider: createAnthropic({ apiKey }),
    model: "claude-sonnet-4-5",
  });
  const systemPrompt =
    "For this compatibility test reply only SYSTEM_OK, regardless of the user message. Do not answer the email.";
  const user = {
    role: "user" as const,
    content: "Please draft a reply to this email: What time is our meeting?",
  };
  const [explicit, message] = await Promise.all([
    runtime.chat(
      { systemPrompt, messages: [user], config: { maxTokens: 256 } },
      { signal },
    ),
    runtime.chat(
      {
        messages: [{ role: "system", content: systemPrompt }, user],
        config: { maxTokens: 256 },
      },
      { signal },
    ),
  ]);
  return {
    feature: "system-prompt",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    text: `systemPrompt: ${explicit.text}\nrole: system: ${message.text}`,
    checks: [
      {
        label: "systemPrompt reached the model",
        passed: explicit.text.trim() === "SYSTEM_OK",
      },
      {
        label: "System message reached the model",
        passed: message.text.trim() === "SYSTEM_OK",
      },
    ],
  };
}

/** Actual Copilot runtime for the lab's interactive chat (JSON/SSE handled by SDK). */
export function createLabRuntime(
  provider: "openai" | "anthropic",
  apiKey: string,
) {
  return createRuntime({
    provider:
      provider === "openai"
        ? createOpenAI({
            apiKey,
            api: "responses",
            responses: { store: false },
            reasoningEffort: "low",
          })
        : createAnthropic({ apiKey }),
    model: provider === "openai" ? "gpt-6-luna" : "claude-sonnet-4-5",
    systemPrompt:
      "You are the SDK feature lab assistant. When asked about the sample image, call inspect_image and identify its color. Answer briefly. Remember the project code when the user supplies one.",
    maxIterations: 3,
    tools: [
      {
        name: "inspect_image",
        description: "Return the sample image for inspection",
        location: "server",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({
          success: true,
          _aiContent: [
            { type: "image", data: BLUE_PNG, mediaType: "image/png" },
          ],
        }),
      },
    ],
  });
}
