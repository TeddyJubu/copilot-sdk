"use client";

import { memo, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Cpu,
  FlaskConical,
  Gauge,
  Layers,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  ScrollText,
  Settings2,
  ShoppingCart,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  CopilotTheme,
  DashboardState,
  GenerativeUIConfig,
  GenerativeUIKey,
  ToolsEnabledConfig,
  ToolKey,
  PersonData,
  LayoutTemplate,
  ProviderId,
  SDKConfig,
  LoaderVariant,
  AlphaConfig,
} from "@/lib/types";
import {
  themes,
  samplePersons,
  layoutTemplates,
  providers,
  OPENROUTER_MODELS,
  LOADER_VARIANTS,
} from "@/lib/constants";
import { useOpenRouterModels } from "@/hooks/useOpenRouterModels";
import { WeatherModule } from "./modules/WeatherModule";
import { StockModule } from "./modules/StockModule";
import { AlertModule } from "./modules/AlertModule";
import { ToolInfoHoverCard } from "./ToolInfoHoverCard";
import { ConfigInfoHoverCard } from "./ConfigInfoHoverCard";
import { AlphaFeaturesSection } from "./AlphaFeaturesSection";
import { toolMetadata } from "@/lib/tool-metadata";
import { configMetadata } from "@/lib/config-metadata";
import { Btn, Led, Segmented } from "@/components/bench/ui";
import { CodeView } from "@/components/bench/CodeView";
import { cn } from "@/lib/utils";

const generativeUIKeys: GenerativeUIKey[] = [
  "weather",
  "stock",
  "notification",
];

const exampleQuestions = [
  "What's my current plan?",
  "How many credits do I have?",
  "What's my name and role?",
];

const triggerClass =
  "h-8 w-full rounded-lg border-input bg-surface px-2.5 text-[13px] shadow-none dark:bg-surface dark:hover:bg-surface hover:border-line-strong";

type InfoKey = Exclude<keyof typeof configMetadata, "generativeUI">;

function Info({ k }: { k: InfoKey }) {
  const meta = configMetadata[k];
  return (
    <ConfigInfoHoverCard
      description={meta.description}
      tip={meta.tip}
      codeSnippet={meta.codeSnippet}
      codeLabel={meta.codeLabel}
    />
  );
}

function Label({
  children,
  info,
  htmlFor,
}: {
  children: React.ReactNode;
  info?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="mb-1.5 flex h-6 items-center gap-0.5">
      <label
        htmlFor={htmlFor}
        className="text-[12px] font-medium text-muted-foreground"
      >
        {children}
      </label>
      {info}
    </div>
  );
}

/** A titled settings group; optionally collapsible. */
function Section({
  icon: Icon,
  title,
  meta,
  actions,
  collapsible,
  defaultOpen = true,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const heading = (
    <>
      <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="text-[13px] font-semibold tracking-[-0.01em]">
        {title}
      </span>
      {meta ? (
        <span className="num truncate text-[11px] font-normal text-faint">
          {meta}
        </span>
      ) : null}
    </>
  );
  return (
    <section aria-labelledby={id} className="panel">
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        {collapsible ? (
          <button
            id={id}
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="group flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            {heading}
            <ChevronDown
              aria-hidden
              className={cn(
                "ml-auto size-4 text-faint transition-transform duration-200 ease-out-strong group-hover:text-foreground",
                open && "rotate-180",
              )}
            />
          </button>
        ) : (
          <h2 id={id} className="flex min-w-0 items-center gap-2.5">
            {heading}
          </h2>
        )}
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </div>
      {open ? (
        <div className={cn("border-t border-line p-4", collapsible && "enter")}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

// OpenRouter model picker: live list from OpenRouter, grouped by provider.
function OpenRouterModelSelector({
  selectedModel,
  onModelChange,
}: {
  selectedModel: string;
  onModelChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customModel, setCustomModel] = useState("");

  // Fetch live models from OpenRouter API
  const { models: liveModels, isLoading } = useOpenRouterModels();

  // Use live models if available, otherwise fallback to static list
  const availableModels = useMemo(() => {
    if (liveModels.length > 0) {
      return liveModels.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0] || "Other",
      }));
    }
    return OPENROUTER_MODELS;
  }, [liveModels]);

  const isPresetModel = availableModels.some((m) => m.id === selectedModel);
  const useCustom =
    customModel !== "" || (!isPresetModel && selectedModel !== "");

  const groupedModels = useMemo(() => {
    // Popular providers first, then alphabetical
    const popularProviders = [
      "openrouter",
      "openai",
      "anthropic",
      "google",
      "x-ai",
      "meta-llama",
      "deepseek",
      "mistralai",
      "qwen",
    ];
    const groups: Record<string, typeof availableModels> = {};
    for (const model of availableModels) {
      if (!groups[model.provider]) groups[model.provider] = [];
      groups[model.provider].push(model);
    }
    const sortedGroups: Record<string, typeof availableModels> = {};
    for (const provider of popularProviders) {
      if (groups[provider]) sortedGroups[provider] = groups[provider];
    }
    for (const provider of Object.keys(groups)
      .filter((p) => !popularProviders.includes(p))
      .sort()) {
      sortedGroups[provider] = groups[provider];
    }
    return sortedGroups;
  }, [availableModels]);

  if (useCustom) {
    return (
      <div className="flex gap-1.5">
        <input
          type="text"
          aria-label="Custom OpenRouter model ID"
          value={customModel || selectedModel}
          onChange={(e) => {
            setCustomModel(e.target.value);
            if (e.target.value.trim()) onModelChange(e.target.value.trim());
          }}
          placeholder="vendor/model-id"
          className="control num h-8 px-2.5 text-[12px]"
        />
        <Btn
          size="icon"
          variant="ghost"
          aria-label="Back to model list"
          onClick={() => {
            setCustomModel("");
            onModelChange(availableModels[0]?.id || "openrouter/auto");
          }}
        >
          <X aria-hidden />
        </Btn>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label="OpenRouter model"
          className="control press flex h-8 items-center justify-between gap-2 px-2.5 text-left"
        >
          <span className="num truncate text-[12px]">{selectedModel}</span>
          {isLoading ? (
            <LoaderCircle
              aria-hidden
              className="size-3.5 shrink-0 animate-spin text-faint"
            />
          ) : (
            <ChevronsUpDown
              aria-hidden
              className="size-3.5 shrink-0 text-faint"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[280px] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search models…"
            className="h-9 text-[12.5px]"
          />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>
              {isLoading ? "Loading models…" : "No model found."}
            </CommandEmpty>
            {Object.entries(groupedModels).map(([provider, models]) => (
              <CommandGroup key={provider} heading={provider}>
                {models.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={`${model.name} ${model.id} ${model.provider}`}
                    onSelect={() => {
                      onModelChange(model.id);
                      setOpen(false);
                    }}
                    className="num justify-between py-1.5 text-[12px]"
                  >
                    {model.id}
                    <Check
                      aria-hidden
                      className={cn(
                        "size-3 text-brand",
                        selectedModel === model.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setCustomModel(" ");
                  setOpen(false);
                }}
                className="py-1.5 text-[12px] text-brand"
              >
                <Plus aria-hidden className="mr-2 size-3" />
                Custom model ID…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One registered tool with its on/off switch and the state it acts on. */
function ToolTile({
  toolKey,
  icon: Icon,
  name,
  builtin,
  on,
  onToggle,
  children,
}: {
  toolKey: ToolKey;
  icon: typeof Gauge;
  name: string;
  builtin?: boolean;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[118px] flex-col rounded-xl p-3 transition-[background-color,box-shadow] duration-200",
        on
          ? "bg-card shadow-[inset_0_0_0_1px_var(--line-strong)]"
          : "bg-surface shadow-[inset_0_0_0_1px_var(--line)]",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden
          className={cn("size-4", on ? "text-brand" : "text-faint")}
        />
        <span className="text-[12.5px] font-medium">{name}</span>
        <ToolInfoHoverCard metadata={toolMetadata[toolKey]} />
        <Switch
          className="ml-auto"
          checked={on}
          onCheckedChange={onToggle}
          aria-label={`${name} tool`}
        />
      </div>
      <p className="num mt-0.5 flex items-center gap-1.5 text-[10.5px] text-faint">
        <Led tone={on ? "ready" : "idle"} className="!size-1.5 !shadow-none" />
        {on ? "registered" : "off"}
        {builtin ? " · built-in" : ""}
      </p>
      <div
        className={cn("mt-auto pt-3 transition-opacity", !on && "opacity-60")}
      >
        {children}
      </div>
    </div>
  );
}

function Stepper({
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusIcon: MinusIcon = Minus,
}: {
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  minusIcon?: typeof Minus;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="num text-[22px] leading-none font-medium tracking-tight">
        {value}
      </span>
      <div className="flex gap-1">
        <Btn
          size="icon"
          variant="outline"
          className="size-7"
          aria-label={minusLabel}
          onClick={onMinus}
        >
          <MinusIcon aria-hidden />
        </Btn>
        <Btn
          size="icon"
          variant="outline"
          className="size-7"
          aria-label={plusLabel}
          onClick={onPlus}
        >
          <Plus aria-hidden />
        </Btn>
      </div>
    </div>
  );
}

interface ControlPanelProps {
  copilotTheme: CopilotTheme;
  onThemeChange: (theme: CopilotTheme) => void;
  layoutTemplate: LayoutTemplate;
  onLayoutChange: (layout: LayoutTemplate) => void;
  selectedProvider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  selectedOpenRouterModel: string;
  onOpenRouterModelChange: (model: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  generativeUI: GenerativeUIConfig;
  onToggleGenerativeUI: (key: GenerativeUIKey) => void;
  toolsEnabled: ToolsEnabledConfig;
  onToggleTool: (key: ToolKey) => void;
  dashboardState: DashboardState;
  onIncrementCounter: () => void;
  onDecrementCounter: () => void;
  onAddToCart: () => void;
  onClearCart: () => void;
  onReset: () => void;
  selectedPerson: PersonData;
  onSelectPerson: (person: PersonData) => void;
  sdkConfig: SDKConfig;
  onUpdateSDKConfig: <K extends keyof SDKConfig>(
    key: K,
    value: SDKConfig[K],
  ) => void;
  alphaConfig: AlphaConfig;
  onUpdateAlpha: <K extends keyof AlphaConfig>(
    key: K,
    value: AlphaConfig[K],
  ) => void;
}

function ControlPanelComponent({
  copilotTheme,
  onThemeChange,
  layoutTemplate,
  onLayoutChange,
  selectedProvider,
  onProviderChange,
  selectedOpenRouterModel,
  onOpenRouterModelChange,
  systemPrompt,
  onSystemPromptChange,
  generativeUI,
  onToggleGenerativeUI,
  toolsEnabled,
  onToggleTool,
  dashboardState,
  onIncrementCounter,
  onDecrementCounter,
  onAddToCart,
  onClearCart,
  onReset,
  selectedPerson,
  onSelectPerson,
  sdkConfig,
  onUpdateSDKConfig,
  alphaConfig,
  onUpdateAlpha,
}: ControlPanelProps) {
  const activeToolCount = Object.values(toolsEnabled).filter(Boolean).length;
  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const activeGenerative = generativeUIKeys.filter(
    (k) => generativeUI[k],
  ).length;

  return (
    <div className="space-y-4">
      {/* Model & appearance */}
      <Section
        icon={Cpu}
        title="Model & appearance"
        meta="CopilotProvider · CopilotChat"
      >
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <div>
            <Label info={<Info k="model" />}>Provider</Label>
            <Select
              value={selectedProvider}
              onValueChange={(v) => onProviderChange(v as ProviderId)}
            >
              <SelectTrigger aria-label="Provider" className={triggerClass}>
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: currentProvider?.color }}
                    />
                    <span className="truncate">
                      {currentProvider?.name}
                      <span className="num ml-1.5 text-[11px] text-faint">
                        {selectedProvider === "openrouter"
                          ? "500+ models"
                          : currentProvider?.model}
                      </span>
                    </span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span>{p.name}</span>
                      <span className="num text-[11px] text-faint">
                        {p.id === "openrouter" ? "500+ models" : p.model}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedProvider === "openrouter" ? (
            <div>
              <Label>Model</Label>
              <OpenRouterModelSelector
                selectedModel={selectedOpenRouterModel}
                onModelChange={onOpenRouterModelChange}
              />
            </div>
          ) : (
            <div>
              <Label>Loader</Label>
              <LoaderSelect
                sdkConfig={sdkConfig}
                onUpdateSDKConfig={onUpdateSDKConfig}
              />
            </div>
          )}

          <div className="sm:col-span-2">
            <Label info={<Info k="theme" />}>Theme</Label>
            <div
              role="radiogroup"
              aria-label="Theme"
              className="grid grid-cols-3 gap-1.5 md:grid-cols-5 xl:grid-cols-9"
            >
              {themes.map((t) => {
                const active = t.id === copilotTheme;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onThemeChange(t.id)}
                    className={cn(
                      "press flex h-14 flex-col items-start justify-between rounded-lg px-2.5 py-2 text-left",
                      active
                        ? "bg-card shadow-[0_0_0_1.5px_var(--brand),0_4px_12px_-6px_var(--brand)]"
                        : "bg-surface shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]",
                    )}
                  >
                    <span className="flex gap-0.5">
                      <span
                        className="size-3 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                        style={{ backgroundColor: t.accent }}
                      />
                      <span className="size-3 rounded-full bg-foreground/10" />
                    </span>
                    <span
                      className={cn(
                        "text-[11.5px]",
                        active ? "font-medium" : "text-muted-foreground",
                      )}
                    >
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sm:col-span-2">
            <Label info={<Info k="layout" />}>Layout</Label>
            <Segmented
              label="Layout"
              className="flex w-full"
              value={layoutTemplate}
              onChange={(v) => onLayoutChange(v)}
              options={layoutTemplates.map((l) => ({
                value: l.id,
                label: l.name,
              }))}
            />
            <p className="mt-1.5 text-[11.5px] text-faint">
              {
                layoutTemplates.find((l) => l.id === layoutTemplate)
                  ?.description
              }
            </p>
          </div>

          {selectedProvider === "openrouter" ? (
            <div>
              <Label>Loader</Label>
              <LoaderSelect
                sdkConfig={sdkConfig}
                onUpdateSDKConfig={onUpdateSDKConfig}
              />
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <Label htmlFor="system-prompt" info={<Info k="systemPrompt" />}>
              System prompt
            </Label>
            <textarea
              id="system-prompt"
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={3}
              className="control num min-h-[76px] text-[12px]"
              placeholder="// Define AI behavior…"
            />
          </div>
        </div>
      </Section>

      {/* Tools & live state */}
      <Section
        icon={Wrench}
        title="Tools & live state"
        meta={`${activeToolCount}/5 registered`}
        actions={
          <Btn size="xs" variant="ghost" onClick={onReset}>
            <RotateCcw aria-hidden />
            Reset all
          </Btn>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          <ToolTile
            toolKey="updateCounter"
            icon={Gauge}
            name="Counter"
            on={toolsEnabled.updateCounter}
            onToggle={() => onToggleTool("updateCounter")}
          >
            <Stepper
              value={dashboardState.counter}
              onMinus={onDecrementCounter}
              onPlus={onIncrementCounter}
              minusLabel="Decrease counter"
              plusLabel="Increase counter"
            />
          </ToolTile>
          <ToolTile
            toolKey="updatePreference"
            icon={Settings2}
            name="Preference"
            on={toolsEnabled.updatePreference}
            onToggle={() => onToggleTool("updatePreference")}
          >
            <p className="num text-[18px] leading-none font-medium text-brand">
              {dashboardState.userPreference}
            </p>
            <p className="mt-1.5 text-[11px] text-faint">
              Set by the AI through a tool
            </p>
          </ToolTile>
          <ToolTile
            toolKey="updateCart"
            icon={ShoppingCart}
            name="Cart"
            on={toolsEnabled.updateCart}
            onToggle={() => onToggleTool("updateCart")}
          >
            <Stepper
              value={dashboardState.cartItems}
              onMinus={onClearCart}
              onPlus={onAddToCart}
              minusLabel="Clear cart"
              plusLabel="Add to cart"
              minusIcon={Trash2}
            />
          </ToolTile>
          <ToolTile
            toolKey="captureScreenshot"
            icon={Camera}
            name="Screenshot"
            builtin
            on={toolsEnabled.captureScreenshot}
            onToggle={() => onToggleTool("captureScreenshot")}
          >
            <p className="text-[12px] text-muted-foreground">
              Captures the current page with consent.
            </p>
          </ToolTile>
          <ToolTile
            toolKey="getConsoleLogs"
            icon={ScrollText}
            name="Console"
            builtin
            on={toolsEnabled.getConsoleLogs}
            onToggle={() => onToggleTool("getConsoleLogs")}
          >
            <p className="text-[12px] text-muted-foreground">
              Reads recent browser console logs.
            </p>
          </ToolTile>
        </div>
      </Section>

      {/* Generative UI */}
      <Section
        icon={Layers}
        title="Generative UI"
        meta={`${activeGenerative}/3 renderers`}
      >
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
          {generativeUIKeys.map((key) => (
            <div key={key} className="flex items-center gap-1">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] capitalize">
                <Switch
                  checked={generativeUI[key]}
                  onCheckedChange={() => onToggleGenerativeUI(key)}
                />
                {key}
              </label>
              <ConfigInfoHoverCard
                description={configMetadata.generativeUI[key].description}
                tip={configMetadata.generativeUI[key].tip}
                codeSnippet={configMetadata.generativeUI[key].codeSnippet}
                codeLabel={configMetadata.generativeUI[key].codeLabel}
              />
            </div>
          ))}
        </div>
        {activeGenerative ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <WeatherModule show={generativeUI.weather} />
            <StockModule show={generativeUI.stock} />
            <AlertModule show={generativeUI.notification} />
          </div>
        ) : (
          <p className="text-[12px] text-faint">
            All renderers are off; tool results show as plain text.
          </p>
        )}
      </Section>

      {/* App context */}
      <Section icon={UserRound} title="App context" meta="useAIContext">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label info={<Info k="context" />}>Signed-in user</Label>
            <div
              role="radiogroup"
              aria-label="Signed-in user"
              className="space-y-1.5"
            >
              {samplePersons.map((person) => {
                const active = selectedPerson.id === person.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelectPerson(person)}
                    className={cn(
                      "press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                      active
                        ? "bg-card shadow-[0_0_0_1.5px_var(--brand)]"
                        : "bg-surface shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                        active
                          ? "bg-brand text-brand-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {person.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium">
                        {person.name}
                      </span>
                      <span className="num block truncate text-[10.5px] text-faint">
                        {person.role} · {person.credits.toLocaleString()}{" "}
                        credits
                      </span>
                    </span>
                    <span className="num text-[10px] tracking-wide text-muted-foreground uppercase">
                      {person.plan}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <Label>What the AI sees</Label>
              <CodeView
                code={JSON.stringify(
                  {
                    name: selectedPerson.name,
                    plan: selectedPerson.plan,
                    credits: selectedPerson.credits,
                  },
                  null,
                  2,
                )}
                className="rounded-lg bg-surface px-3 py-2.5 text-[11.5px] shadow-[inset_0_0_0_1px_var(--line)]"
              />
            </div>
            <div>
              <Label>Try asking</Label>
              <ul className="space-y-1">
                {exampleQuestions.map((q) => (
                  <li
                    key={q}
                    className="rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    “{q}”
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* Alpha features */}
      <Section
        icon={FlaskConical}
        title="Alpha features"
        meta="experimental · in development"
        collapsible
        defaultOpen={false}
      >
        <AlphaFeaturesSection
          alphaConfig={alphaConfig}
          onUpdate={onUpdateAlpha}
        />
      </Section>
    </div>
  );
}

function LoaderSelect({
  sdkConfig,
  onUpdateSDKConfig,
}: {
  sdkConfig: SDKConfig;
  onUpdateSDKConfig: ControlPanelProps["onUpdateSDKConfig"];
}) {
  return (
    <Select
      value={sdkConfig.loaderVariant}
      onValueChange={(v) =>
        onUpdateSDKConfig("loaderVariant", v as LoaderVariant)
      }
    >
      <SelectTrigger aria-label="Loader" className={triggerClass}>
        <SelectValue>
          {LOADER_VARIANTS.find((l) => l.id === sdkConfig.loaderVariant)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {LOADER_VARIANTS.map((variant) => (
          <SelectItem key={variant.id} value={variant.id}>
            <div className="flex flex-col">
              <span>{variant.label}</span>
              <span className="text-[11px] text-faint">
                {variant.description}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const ControlPanel = memo(ControlPanelComponent);
