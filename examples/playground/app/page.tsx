"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import type { ProviderId, PersonData } from "@/lib/types";
import { samplePersons } from "@/lib/constants";
import { DOCS_URL } from "@/lib/documentation";

// Hooks
import { useDashboardState } from "@/hooks/useDashboardState";
import { usePlaygroundConfig } from "@/hooks/usePlaygroundConfig";

// Components
import { ControlPanel } from "@/components/playground/ControlPanel";
import { CopilotSidebar } from "@/components/playground/CopilotSidebar";
import { WelcomeModal } from "@/components/modals/WelcomeModal";
import { AppShell, Crumbs } from "@/components/bench/AppShell";
import { FeatureNav } from "@/components/bench/FeatureNav";
import { KeysProvider, useKeys } from "@/components/bench/keys";

// Theme CSS imports
import "@yourgpt/copilot-sdk/ui/styles.css";
import "@yourgpt/copilot-sdk/ui/themes/claude.css";
import "@yourgpt/copilot-sdk/ui/themes/linear.css";
import "@yourgpt/copilot-sdk/ui/themes/vercel.css";
import "@yourgpt/copilot-sdk/ui/themes/twitter.css";
import "@yourgpt/copilot-sdk/ui/themes/catppuccin.css";
import "@yourgpt/copilot-sdk/ui/themes/supabase.css";
import "@yourgpt/copilot-sdk/ui/themes/modern-minimal.css";
import "@yourgpt/copilot-sdk/ui/themes/posthog.css";

const noopSubscribe = () => () => {};

function Dashboard() {
  const {
    keys: apiKeys,
    hydrated,
    serverChecked,
    isReady,
    openKeys,
    keysOpen,
  } = useKeys();
  const { state: dashboardState, actions } = useDashboardState();
  const {
    copilotTheme,
    layoutTemplate,
    systemPrompt,
    generativeUI,
    toolsEnabled,
    sdkConfig,
    selectedProvider,
    selectedOpenRouterModel,
    alphaConfig,
    updateTheme,
    updateLayoutTemplate,
    updateSystemPrompt,
    toggleGenerativeUI,
    toggleTool,
    updateSDKConfig,
    updateProvider,
    updateOpenRouterModel,
    updateAlphaConfig,
  } = usePlaygroundConfig();

  // Stored configuration is browser-only; render the workspace after hydration.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [selectedPerson, setSelectedPerson] = useState<PersonData>(
    samplePersons[0],
  );

  // Welcome dialog: first visit with no saved keys.
  const hasAnyApiKey =
    Object.values(apiKeys).some((key) => !!key) ||
    (["openai", "anthropic", "openrouter"] as const).some(isReady);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const showWelcomeModal =
    hydrated &&
    serverChecked &&
    !hasAnyApiKey &&
    !welcomeDismissed &&
    !keysOpen;

  const handleProviderChange = useCallback(
    (provider: ProviderId) => updateProvider(provider),
    [updateProvider],
  );
  const handleOpenRouterModelChange = useCallback(
    (model: string) => updateOpenRouterModel(model),
    [updateOpenRouterModel],
  );
  const handleSelectPerson = useCallback((person: PersonData) => {
    setSelectedPerson(person);
  }, []);
  const handleIncrementCounter = useCallback(() => {
    actions.incrementCounter();
  }, [actions]);
  const handleDecrementCounter = useCallback(() => {
    actions.decrementCounter();
  }, [actions]);
  const handleAddToCart = useCallback(() => {
    actions.updateCart("add", 1);
  }, [actions]);
  const handleClearCart = useCallback(() => {
    actions.updateCart("clear");
  }, [actions]);

  return (
    <AppShell
      active="chat"
      docsPath="/getting-started"
      fixedHeight
      crumb={<Crumbs items={["Playground", "Copilot chat"]} />}
      rail={<FeatureNav mode="links" />}
    >
      {mounted ? (
        <div className="lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
          <div className="lg:h-full lg:overflow-y-auto">
            <div className="mx-auto w-full max-w-[940px] space-y-5 px-4 py-6 sm:px-6 lg:py-8">
              <header className="max-w-[620px]">
                <p className="eyebrow">
                  <span className="text-brand">Copilot SDK</span> · React
                </p>
                <h1 className="mt-2 text-[24px] leading-tight font-semibold tracking-[-0.025em]">
                  Copilot chat
                </h1>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  Configure the provider, theme and tools, then talk to the
                  Copilot in the live preview. Its tools read and change the
                  state below.
                </p>
                <nav
                  aria-label="Copilot guides"
                  className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12.5px] font-medium text-brand"
                >
                  {[
                    ["Quick start", "/getting-started"],
                    ["Tool calling", "/tools"],
                    ["Feature guides", "/feature-lab"],
                  ].map(([label, path]) => (
                    <a
                      key={path}
                      href={`${DOCS_URL}${path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {label}
                    </a>
                  ))}
                </nav>
              </header>
              <ControlPanel
                copilotTheme={copilotTheme}
                onThemeChange={updateTheme}
                layoutTemplate={layoutTemplate}
                onLayoutChange={updateLayoutTemplate}
                selectedProvider={selectedProvider}
                onProviderChange={handleProviderChange}
                selectedOpenRouterModel={selectedOpenRouterModel}
                onOpenRouterModelChange={handleOpenRouterModelChange}
                systemPrompt={systemPrompt}
                onSystemPromptChange={updateSystemPrompt}
                generativeUI={generativeUI}
                onToggleGenerativeUI={toggleGenerativeUI}
                toolsEnabled={toolsEnabled}
                onToggleTool={toggleTool}
                dashboardState={dashboardState}
                onIncrementCounter={handleIncrementCounter}
                onDecrementCounter={handleDecrementCounter}
                onAddToCart={handleAddToCart}
                onClearCart={handleClearCart}
                onReset={actions.reset}
                selectedPerson={selectedPerson}
                onSelectPerson={handleSelectPerson}
                sdkConfig={sdkConfig}
                onUpdateSDKConfig={updateSDKConfig}
                alphaConfig={alphaConfig}
                onUpdateAlpha={updateAlphaConfig}
              />
            </div>
          </div>

          <CopilotSidebar
            systemPrompt={systemPrompt}
            copilotTheme={copilotTheme}
            layoutTemplate={layoutTemplate}
            dashboardState={dashboardState}
            actions={actions}
            selectedPerson={selectedPerson}
            toolsEnabled={toolsEnabled}
            generativeUI={generativeUI}
            selectedProvider={selectedProvider}
            selectedOpenRouterModel={selectedOpenRouterModel}
            apiKeys={apiKeys}
            loaderVariant={sdkConfig.loaderVariant}
            alphaConfig={alphaConfig}
            onOpenKeys={openKeys}
            providerReady={isReady(selectedProvider)}
          />
        </div>
      ) : null}

      <WelcomeModal
        open={showWelcomeModal}
        onOpenChange={(open) => !open && setWelcomeDismissed(true)}
        onTryWithApiKeys={openKeys}
      />
    </AppShell>
  );
}

export default function PlaygroundPage() {
  return (
    <KeysProvider>
      <Dashboard />
    </KeysProvider>
  );
}
