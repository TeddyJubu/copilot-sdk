import {
  experimental_decide,
  type DecisionModel,
  type DecisionQuestions,
} from "@yourgpt/llm-sdk";
import { openaiDecision } from "@yourgpt/llm-sdk/openai";
import { openrouterDecision } from "@yourgpt/llm-sdk/openrouter";
import { typesafeDecision } from "@yourgpt/llm-sdk/typesafe";
import { cloudflareDecision } from "@yourgpt/llm-sdk/cloudflare";
import { features, type LabInput, type LabResult } from "../catalog";

export async function decisionsExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  let model: DecisionModel;
  switch (input.provider) {
    case "openai":
      model = openaiDecision(undefined, { apiKey });
      break;
    case "openrouter":
      model = openrouterDecision(undefined, { apiKey });
      break;
    case "typesafe":
      model = typesafeDecision(undefined, { apiKey });
      break;
    case "cloudflare":
      model = cloudflareDecision(undefined, { apiKey });
      break;
    default:
      throw new Error("Unsupported Decisions provider");
  }
  const questions: DecisionQuestions = {
    outage: {
      type: "boolean",
      instructions:
        "Does this ticket report a service outage affecting all customers?",
    },
    team: {
      type: "choice",
      instructions: "Which team owns this ticket?",
      criteria: {
        billing: "Invoices, payments and refunds",
        engineering: "Errors, outages and broken features",
        support: "General help and anything else",
      },
    },
    impact: {
      type: "score",
      instructions: "How severe is the interruption?",
      criteria: [
        "No interruption",
        "Some users or features blocked",
        "All users blocked",
      ],
    },
    ...(input.file && {
      visible: {
        type: "choice" as const,
        instructions: "What is the dominant color of the attached image?",
        criteria: {
          blue: "Mostly blue",
          red: "Mostly red",
          other: "Any other color",
        },
      },
    }),
  };
  const result = await experimental_decide({
    model,
    signal,
    state: {
      ticket:
        input.text || features.find((f) => f.id === "decisions")!.defaultText!,
    },
    questions,
    ...(input.file && {
      images: [{ data: Buffer.from(input.file.base64, "base64") }],
    }),
  });
  const team = result.answers.team;
  // Illustrative threshold, not a production guardrail policy. Refusals require review.
  const route =
    team.type === "choice" && (team.probabilities?.[team.choice] ?? 0) >= 0.9
      ? team.choice
      : "human-review";
  return {
    feature: "decisions",
    provider: input.provider,
    model: result.response.modelId,
    text: `Suggested route: ${route}. Threshold 0.9 is illustrative; calibrate it with labeled tickets.`,
    checks: [
      {
        label: "One validated answer per question",
        passed:
          Object.keys(result.answers).length === Object.keys(questions).length,
      },
    ],
    details: {
      answers: result.answers,
      usage: result.usage,
      route,
      refusal: Object.values(result.answers).some(
        (answer) => answer.type === "refusal",
      ),
    },
  };
}
