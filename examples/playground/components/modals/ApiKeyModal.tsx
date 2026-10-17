"use client";

import { useState, useCallback, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Key, Shield, Check, BookOpen, ExternalLink } from "lucide-react";
import type { ApiKeys } from "@/lib/types";
import { providers } from "@/lib/constants";

interface ApiKeyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeys: ApiKeys;
  onSave: (keys: ApiKeys) => void;
}

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
    }, 1000);
  }, [localKeys, onSave, onOpenChange]);

  const handleKeyChange = useCallback(
    (providerId: keyof ApiKeys, value: string) => {
      setLocalKeys((prev) => ({ ...prev, [providerId]: value }));
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" />
            API Configuration
          </DialogTitle>
          <DialogDescription className="text-xs">
            Configure your API keys for different providers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Security Notice */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              Keys are saved in this browser and sent to the playground server
              for your requests to the selected provider. They are not added to
              the server configuration.
            </p>
          </div>

          {/* Provider Keys */}
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {providers.map((provider) => (
              <div key={provider.id} className="space-y-1.5">
                <label
                  htmlFor={`api-key-${provider.id}`}
                  className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: provider.color }}
                  />
                  {provider.name}
                  {localKeys[provider.id] ? (
                    <Check className="h-3 w-3 text-emerald-500 ml-auto" />
                  ) : null}
                </label>
                <input
                  id={`api-key-${provider.id}`}
                  type="password"
                  value={localKeys[provider.id]}
                  onChange={(e) => handleKeyChange(provider.id, e.target.value)}
                  placeholder={provider.keyPlaceholder}
                  className="w-full h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <p className="text-[10px] text-zinc-500">
                  Get your key from{" "}
                  <a
                    href={provider.keyLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {provider.keyLinkText}
                  </a>
                </p>
              </div>
            ))}
            <p className="text-xs font-medium pt-2">
              Additional Decisions providers
            </p>
            {(
              [
                ["typesafe", "TypeSafe / Jev API key", "password"],
                ["cloudflare", "Cloudflare API token", "password"],
                ["cloudflareAccountId", "Cloudflare account ID", "text"],
              ] as const
            ).map(([id, label, type]) => (
              <div key={id} className="space-y-1.5">
                <label
                  htmlFor={`api-key-${id}`}
                  className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {label}
                </label>
                <input
                  id={`api-key-${id}`}
                  type={type}
                  autoComplete="off"
                  value={localKeys[id] ?? ""}
                  onChange={(event) => handleKeyChange(id, event.target.value)}
                  className="w-full h-8 px-3 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono"
                />
              </div>
            ))}
          </div>

          {/* Explore more link */}
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <a
              href="https://copilot-sdk.yourgpt.ai/docs/providers"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Explore more providers in Copilot SDK docs
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
          >
            {saved ? (
              <>
                <Check className="h-3 w-3" />
                Saved
              </>
            ) : (
              "Save Keys"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const ApiKeyModal = memo(ApiKeyModalComponent);
