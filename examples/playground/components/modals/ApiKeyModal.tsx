"use client";

import { useState, useCallback, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ArrowUpRight, Check, KeyRound } from "lucide-react";
import type { ApiKeys } from "@/lib/types";
import { providers } from "@/lib/constants";
import { Btn, Note } from "@/components/bench/ui";
import { cn } from "@/lib/utils";

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
}

const decisionFields = [
  ["typesafe", "TypeSafe / Jev API key", "password"],
  ["cloudflare", "Cloudflare API token", "password"],
  ["cloudflareAccountId", "Cloudflare account ID", "text"],
] as const;

function ApiKeyModalComponent({
  open,
  onOpenChange,
  apiKeys,
  onSave,
}: ApiKeyModalProps) {
  const [localKeys, setLocalKeys] = useState(apiKeys);
  const [sourceKeys, setSourceKeys] = useState(apiKeys);
  const [saved, setSaved] = useState(false);

  if (sourceKeys !== apiKeys) {
    setSourceKeys(apiKeys);
    setLocalKeys(apiKeys);
  }

  const handleSave = useCallback(() => {
    onSave(localKeys);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onOpenChange(false);
    }, 900);
  }, [localKeys, onSave, onOpenChange]);

  const handleKeyChange = useCallback(
    (providerId: keyof ApiKeys, value: string) => {
      setLocalKeys((prev) => ({ ...prev, [providerId]: value }));
    },
    [],
  );

  const inputClass = "control num h-8 px-2.5 text-[12px]";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-[var(--shadow-panel),0_24px_60px_-20px_oklch(0_0_0/45%)] sm:max-w-[520px]">
        <DialogHeader className="border-b border-line px-5 pt-5 pb-4 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
            <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-brand">
              <KeyRound aria-hidden className="size-3.5" />
            </span>
            API keys
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground">
            One set of keys for the Copilot chat and every Feature lab example.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(560px,70dvh)] space-y-5 overflow-y-auto px-5 py-4">
          <Note>
            Keys are saved in this browser and sent to the playground server
            only for requests to the selected provider. They are never added to
            the server configuration.
          </Note>

          <fieldset className="space-y-3">
            <legend className="eyebrow mb-2">Chat providers</legend>
            {providers.map((provider) => {
              const set = !!localKeys[provider.id]?.trim();
              return (
                <div key={provider.id}>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label
                      htmlFor={`api-key-${provider.id}`}
                      className="flex items-center gap-2 text-[12.5px] font-medium"
                    >
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: provider.color }}
                      />
                      {provider.name}
                      {set ? (
                        <Check aria-hidden className="size-3 text-success" />
                      ) : null}
                    </label>
                    <a
                      href={provider.keyLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="num inline-flex items-center gap-0.5 text-[11px] text-faint hover:text-foreground"
                    >
                      {provider.keyLinkText}
                      <ArrowUpRight aria-hidden className="size-3" />
                    </a>
                  </div>
                  <input
                    id={`api-key-${provider.id}`}
                    type="password"
                    autoComplete="off"
                    value={localKeys[provider.id]}
                    onChange={(e) =>
                      handleKeyChange(provider.id, e.target.value)
                    }
                    placeholder={provider.keyPlaceholder}
                    className={inputClass}
                  />
                </div>
              );
            })}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="eyebrow mb-2">
              Additional Decisions providers
            </legend>
            {decisionFields.map(([id, label, type]) => (
              <div key={id}>
                <label
                  htmlFor={`api-key-${id}`}
                  className="mb-1 block text-[12.5px] font-medium"
                >
                  {label}
                </label>
                <input
                  id={`api-key-${id}`}
                  type={type}
                  autoComplete="off"
                  value={localKeys[id] ?? ""}
                  onChange={(event) => handleKeyChange(id, event.target.value)}
                  className={inputClass}
                />
              </div>
            ))}
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
          <a
            href="https://copilot-sdk.yourgpt.ai/docs/providers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            More providers in the docs
            <ArrowUpRight aria-hidden className="size-3" />
          </a>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSave}
              className={cn("min-w-[92px]", saved && "brightness-110")}
            >
              {saved ? (
                <>
                  <Check aria-hidden />
                  Saved
                </>
              ) : (
                "Save Keys"
              )}
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const ApiKeyModal = memo(ApiKeyModalComponent);
