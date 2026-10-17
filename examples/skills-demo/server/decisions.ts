/** Standalone native Decisions example. Does not change the existing chat server. */
import { pathToFileURL } from "node:url";
import { experimental_decide, type DecisionModel } from "@yourgpt/llm-sdk";
import { openaiDecision } from "@yourgpt/llm-sdk/openai";
import { openrouterDecision } from "@yourgpt/llm-sdk/openrouter";
import { typesafeDecision } from "@yourgpt/llm-sdk/typesafe";
import { cloudflareDecision } from "@yourgpt/llm-sdk/cloudflare";

export async function routeTicket(model: DecisionModel, ticket: string) {
  const result = await experimental_decide({
    model,
    state: { ticket },
    questions: {
      outage: {
        type: "boolean",
        instructions:
          "Does the ticket report a service outage affecting all customers?",
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
        instructions: "How severe is the interruption to service?",
        criteria: [
          "No service interruption",
          "Some users or features blocked",
          "All users blocked",
        ],
      },
    },
  });
  const team = result.answers.team;
  // Illustrative threshold only. Evaluate thresholds on your own labeled tickets.
  // A probability and provider confidence are different signals, not accuracy guarantees.
  const route =
    team.type === "choice" && (team.probabilities?.[team.choice] ?? 0) >= 0.9
      ? team.choice
      : "human-review";
  return {
    route,
    answers: result.answers,
    usage: result.usage,
    model: result.response.modelId,
  };
}

async function main() {
  const provider = process.argv[2] ?? "openai";
  const factories = {
    openai: openaiDecision,
    openrouter: openrouterDecision,
    typesafe: typesafeDecision,
    cloudflare: cloudflareDecision,
  };
  if (!Object.prototype.hasOwnProperty.call(factories, provider))
    throw new Error("Choose openai, openrouter, typesafe, or cloudflare");
  const model = factories[provider as keyof typeof factories]();
  const result = await routeTicket(
    model,
    "My invoice has a duplicate charge. The service is working normally; please refund the extra charge.",
  );
  console.log(JSON.stringify(result, null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    // Never print credentials, request bodies, or raw provider errors.
    console.error(
      error instanceof Error ? error.message : "Decision example failed",
    );
    process.exitCode = 1;
  });
}
