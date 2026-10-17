"use client";
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import { CopilotChat } from "@yourgpt/copilot-sdk/ui";
import "@yourgpt/copilot-sdk/ui/styles.css";
export default function ChatPanel({
  provider,
  streaming,
}: {
  provider: "openai" | "anthropic";
  streaming: boolean;
}) {
  return (
    <div style={{ height: 520 }} data-testid="lab-chat">
      <CopilotProvider
        key={`${provider}-${streaming}`}
        runtimeUrl={`/playground/api/features/chat?provider=${provider}`}
        streaming={streaming}
      >
        <CopilotChat
          className="h-full"
          header={{ name: "Feature lab Copilot" }}
          showHeader
          suggestions={[
            "Inspect the sample image. What color is it?",
            "The project code is ORCHID-742. Remember it.",
          ]}
          placeholder="Test a tool or continue the conversation…"
        />
      </CopilotProvider>
    </div>
  );
}
