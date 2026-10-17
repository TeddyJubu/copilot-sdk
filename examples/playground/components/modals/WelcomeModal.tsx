"use client";

import { useCallback, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ArrowUpRight, Github, KeyRound } from "lucide-react";
import { GITHUB_REPO_URL } from "@/lib/constants";
import CopilotSDKLogo from "@/components/CopilotSDKLogo";
import { Btn } from "@/components/bench/ui";

interface WelcomeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTryWithApiKeys: () => void;
}

function WelcomeModalComponent({
  open,
  onOpenChange,
  onTryWithApiKeys,
}: WelcomeModalProps) {
  const handleTryHere = useCallback(() => {
    onOpenChange(false);
    onTryWithApiKeys();
  }, [onOpenChange, onTryWithApiKeys]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-[var(--shadow-panel),0_24px_60px_-20px_oklch(0_0_0/45%)] sm:max-w-[440px]">
        <div className="bench-grid h-20 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <DialogHeader className="-mt-12 px-6 pb-2 text-left">
          <CopilotSDKLogo aria-hidden className="mb-3 size-9" />
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.02em]">
            Welcome to the Copilot SDK playground
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            Chat with a configurable Copilot and try SDK features with real
            providers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-6 pt-3 pb-6">
          <Btn
            variant="primary"
            size="lg"
            className="w-full"
            onClick={handleTryHere}
          >
            <KeyRound aria-hidden />
            Add API Keys
          </Btn>
          <p className="pb-2 text-center text-[11.5px] text-faint">
            Keys stay in this browser and are sent only with your requests.
          </p>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-muted">
              <Github aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">
                Run locally
              </span>
              <span className="block text-[11.5px] text-faint">
                Clone the repo for the full experience with tool execution.
              </span>
            </span>
            <ArrowUpRight aria-hidden className="size-4 text-faint" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const WelcomeModal = memo(WelcomeModalComponent);
