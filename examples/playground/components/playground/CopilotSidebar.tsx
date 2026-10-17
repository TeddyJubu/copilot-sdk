"use client";

import { useMemo, useCallback } from "react";
import { toast } from "sonner";
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import { CopilotPanel } from "./CopilotPanel";
import { themes, layoutTemplates, providers } from "@/lib/constants";
import { Btn, Led } from "@/components/bench/ui";
import type {
  CopilotTheme,
  DashboardState,
  PersonData,
  LayoutTemplate,
  ToolsEnabledConfig,
  GenerativeUIConfig,
  ProviderId,
  ApiKeys,
  LoaderVariant,
  AlphaConfig,
} from "@/lib/types";
import type { DashboardActions } from "@/hooks/useDashboardState";

interface CopilotSidebarProps {
  systemPrompt: string;
  copilotTheme: CopilotTheme;
  layoutTemplate: LayoutTemplate;
  dashboardState: DashboardState;
  actions: DashboardActions;
  selectedPerson: PersonData;
  toolsEnabled: ToolsEnabledConfig;
  generativeUI: GenerativeUIConfig;
  selectedProvider: ProviderId;
  selectedOpenRouterModel: string;
  apiKeys: ApiKeys;
  loaderVariant: LoaderVariant;
  alphaConfig: AlphaConfig;
  onOpenKeys: () => void;
  /** Browser key or local server key available for the selected provider. */
  providerReady: boolean;
}

export function CopilotSidebar({
  systemPrompt,
  copilotTheme,
  layoutTemplate,
  dashboardState,
  actions,
  selectedPerson,
  toolsEnabled,
  generativeUI,
  selectedProvider,
  selectedOpenRouterModel,
  apiKeys,
  loaderVariant,
  alphaConfig,
  onOpenKeys,
  providerReady,
}: CopilotSidebarProps) {
  // Build runtime URL with provider and model selection
  const runtimeUrl = useMemo(() => {
    const baseUrl = `/playground/api/${selectedProvider}`;
    const params = new URLSearchParams();

    // Add model param for OpenRouter
    if (selectedProvider === "openrouter" && selectedOpenRouterModel) {
      params.set("model", selectedOpenRouterModel);
    }

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
  }, [selectedProvider, selectedOpenRouterModel]);

  // Pass API key via headers instead of query params (security best practice)
  const runtimeHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    const apiKey = apiKeys[selectedProvider];
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    return headers;
  }, [selectedProvider, apiKeys]);

  // Error handler - shows toast and logs to console
  const handleError = useCallback((error: Error) => {
    toast.error("Copilot Error", {
      description: error.message,
      duration: 5000,
      id: "copilot-error",
      position: "top-center",
    });
    console.error(
      `%c[Copilot Error]%c ${error.message}`,
      "background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;",
      "color: #ef4444;",
    );
  }, []);

  const provider = providers.find((p) => p.id === selectedProvider);
  const hasKey = providerReady;
  const model =
    selectedProvider === "openrouter"
      ? selectedOpenRouterModel || "openrouter"
      : provider?.model;

  return (
    <aside
      aria-label="Copilot preview"
      className="flex h-[680px] flex-col border-t border-line bg-surface lg:h-full lg:border-t-0 lg:border-l"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Led tone={hasKey ? "ready" : "idle"} />
          <span className="text-[12.5px] font-medium">Live preview</span>
          <span className="num truncate text-[11px] text-faint">
            {provider?.name} · {model}
          </span>
        </div>
        {hasKey ? (
          <span className="num shrink-0 text-[11px] text-faint">
            {themes.find((t) => t.id === copilotTheme)?.label} ·{" "}
            {layoutTemplates.find((l) => l.id === layoutTemplate)?.name}
          </span>
        ) : (
          <Btn size="xs" variant="primary" onClick={onOpenKeys}>
            Add {provider?.name} key
          </Btn>
        )}
      </div>
      <div className="min-h-0 flex-1 p-2.5">
        <div className="h-full overflow-hidden rounded-xl bg-card shadow-[var(--shadow-panel)]">
          <CopilotProvider
            debug={true}
            key={`${selectedProvider}-${selectedOpenRouterModel}`} // Force re-mount when provider or model changes
            runtimeUrl={runtimeUrl}
            headers={runtimeHeaders}
            systemPrompt={systemPrompt}
            maxIterations={5}
            onError={handleError}
            messageHistory={
              alphaConfig.compactionStrategy !== "none"
                ? { strategy: alphaConfig.compactionStrategy }
                : undefined
            }
          >
            <CopilotPanel
              theme={copilotTheme}
              layoutTemplate={layoutTemplate}
              dashboardState={dashboardState}
              actions={actions}
              currentPerson={selectedPerson}
              toolsEnabled={toolsEnabled}
              generativeUI={generativeUI}
              loaderVariant={loaderVariant}
              alphaConfig={alphaConfig}
            />
          </CopilotProvider>
        </div>
      </div>
    </aside>
  );
}
