"use client";

import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AlphaConfig, CompactionStrategy } from "@/lib/types";

interface AlphaFeaturesSectionProps {
  alphaConfig: AlphaConfig;
  onUpdate: <K extends keyof AlphaConfig>(
    key: K,
    value: AlphaConfig[K],
  ) => void;
}

function FeatureRow({
  label,
  description,
  checked,
  onCheckedChange,
  id,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[12.5px] font-medium">{label}</span>
        <span className="block text-[11.5px] leading-snug text-faint">
          {description}
        </span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2 first:pt-0 last:pb-0">
      <p className="eyebrow pb-0.5">{title}</p>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

export function AlphaFeaturesSection({
  alphaConfig,
  onUpdate,
}: AlphaFeaturesSectionProps) {
  return (
    <div className="divide-y divide-line">
      <p className="pb-3 text-[12px] text-muted-foreground">
        These features are in active development and may change between
        releases.
      </p>

      <Group title="Message actions">
        <FeatureRow
          id="alpha-copy"
          label="Copy action"
          description="Copy button on assistant messages"
          checked={alphaConfig.messageActions.copyEnabled}
          onCheckedChange={(v) =>
            onUpdate("messageActions", {
              ...alphaConfig.messageActions,
              copyEnabled: v,
            })
          }
        />
        <FeatureRow
          id="alpha-edit"
          label="Edit action"
          description="Edit button on user messages (creates a branch)"
          checked={alphaConfig.messageActions.editEnabled}
          onCheckedChange={(v) =>
            onUpdate("messageActions", {
              ...alphaConfig.messageActions,
              editEnabled: v,
            })
          }
        />
        <FeatureRow
          id="alpha-feedback"
          label="Feedback action"
          description="Thumbs up/down on assistant messages"
          checked={alphaConfig.messageActions.feedbackEnabled}
          onCheckedChange={(v) =>
            onUpdate("messageActions", {
              ...alphaConfig.messageActions,
              feedbackEnabled: v,
            })
          }
        />
      </Group>

      <Group title="Branching">
        <FeatureRow
          id="alpha-branching"
          label="Conversation branching"
          description="Edit messages to create parallel conversation paths"
          checked={alphaConfig.branchingEnabled}
          onCheckedChange={(v) => onUpdate("branchingEnabled", v)}
        />
      </Group>

      <Group title="Skills">
        <FeatureRow
          id="alpha-brand-voice"
          label="Brand voice"
          description="Eager skill — always active, sets response tone"
          checked={alphaConfig.brandVoiceSkill}
          onCheckedChange={(v) => onUpdate("brandVoiceSkill", v)}
        />
        <FeatureRow
          id="alpha-code-review"
          label="Code review"
          description="Auto skill — loaded when a code review is requested"
          checked={alphaConfig.codeReviewSkill}
          onCheckedChange={(v) => onUpdate("codeReviewSkill", v)}
        />
      </Group>

      <Group title="Context management">
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <span className="block text-[12.5px] font-medium">
              Compaction strategy
            </span>
            <span className="block text-[11.5px] text-faint">
              How older messages are trimmed from the request
            </span>
          </div>
          <Select
            value={alphaConfig.compactionStrategy}
            onValueChange={(v) =>
              onUpdate("compactionStrategy", v as CompactionStrategy)
            }
          >
            <SelectTrigger
              aria-label="Compaction strategy"
              className="h-7 w-[150px] rounded-md bg-surface text-[12px] shadow-none dark:bg-surface"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-[12px]">
                None (default)
              </SelectItem>
              <SelectItem value="sliding-window" className="text-[12px]">
                Sliding window
              </SelectItem>
              <SelectItem value="selective-prune" className="text-[12px]">
                Selective prune
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FeatureRow
          id="alpha-session"
          label="Session persistence"
          description="Survive page reloads via IndexedDB"
          checked={alphaConfig.sessionPersistence}
          onCheckedChange={(v) => onUpdate("sessionPersistence", v)}
        />
        <FeatureRow
          id="alpha-ctx-stats"
          label="Context stats"
          description="Show a token usage bar in the chat"
          checked={alphaConfig.contextStats}
          onCheckedChange={(v) => onUpdate("contextStats", v)}
        />
      </Group>

      <Group title="Advanced tools">
        <FeatureRow
          id="alpha-hidden"
          label="Hidden analytics tool"
          description="Silent tool — runs without showing in the chat UI"
          checked={alphaConfig.hiddenAnalytics}
          onCheckedChange={(v) => onUpdate("hiddenAnalytics", v)}
        />
        <FeatureRow
          id="alpha-deferred"
          label="Deferred search tool"
          description="Only injected when the query is relevant (saves tokens)"
          checked={alphaConfig.deferredSearch}
          onCheckedChange={(v) => onUpdate("deferredSearch", v)}
        />
      </Group>

      <Group title="Custom message view">
        <FeatureRow
          id="alpha-msg-view"
          label="Custom messageView"
          description="Inject a custom footer below the message list"
          checked={alphaConfig.customMessageView}
          onCheckedChange={(v) => onUpdate("customMessageView", v)}
        />
      </Group>
    </div>
  );
}
