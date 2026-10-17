"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ApiKeys } from "@/lib/types";
import { API_KEYS_STORAGE_KEY, INITIAL_API_KEYS } from "@/lib/constants";
import { ApiKeyModal } from "@/components/modals/ApiKeyModal";

interface KeysContextValue {
  keys: ApiKeys;
  /**
   * Providers with a key in the local server environment. Only reported by a
   * local development server started with the Feature lab flag; always empty
   * on deployed builds, which use caller keys only.
   */
  serverKeys: Partial<Record<keyof ApiKeys, boolean>>;
  /** True once the local key status request has settled. */
  serverChecked: boolean;
  /** True when the provider has a browser key or a local server key. */
  isReady: (provider: keyof ApiKeys) => boolean;
  /** False until browser storage has been read, so SSR and hydration agree. */
  hydrated: boolean;
  updateKeys: (keys: ApiKeys) => void;
  openKeys: () => void;
  keysOpen: boolean;
}

const KeysContext = createContext<KeysContextValue | null>(null);
const noopSubscribe = () => () => {};

function readStoredKeys(): ApiKeys {
  try {
    const stored = localStorage.getItem(API_KEYS_STORAGE_KEY);
    return stored
      ? { ...INITIAL_API_KEYS, ...JSON.parse(stored) }
      : INITIAL_API_KEYS;
  } catch {
    return INITIAL_API_KEYS;
  }
}

/** One key store and one key dialog shared by every playground page. */
export function KeysProvider({ children }: { children: React.ReactNode }) {
  // Server render and hydration see no keys; the client then reads storage once.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const stored = useMemo(
    () => (hydrated ? readStoredKeys() : INITIAL_API_KEYS),
    [hydrated],
  );
  const [edited, setEdited] = useState<ApiKeys | null>(null);
  const keys = edited ?? stored;
  const [keysOpen, setKeysOpen] = useState(false);
  const [serverKeys, setServerKeys] = useState<
    Partial<Record<keyof ApiKeys, boolean>>
  >({});
  const [serverChecked, setServerChecked] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/playground/api/features/status", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data?.localCredentials) return;
        const next: Partial<Record<keyof ApiKeys, boolean>> = {};
        for (const [id, value] of Object.entries(data.providers ?? {}))
          next[id as keyof ApiKeys] = !!(value as { configured?: boolean })
            ?.configured;
        setServerKeys(next);
      })
      .catch(() => {
        // Status is informational; the key dialog still works without it.
      })
      .finally(() => {
        if (!controller.signal.aborted) setServerChecked(true);
      });
    return () => controller.abort();
  }, []);

  const isReady = useCallback(
    (provider: keyof ApiKeys) =>
      (hydrated && !!keys[provider]?.trim()) || !!serverKeys[provider],
    [hydrated, keys, serverKeys],
  );

  const updateKeys = useCallback((next: ApiKeys) => {
    setEdited(next);
    try {
      localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable (private mode); keys still apply for this page.
    }
  }, []);

  const openKeys = useCallback(() => setKeysOpen(true), []);

  const value = useMemo(
    () => ({
      keys,
      serverKeys,
      serverChecked,
      isReady,
      hydrated,
      updateKeys,
      openKeys,
      keysOpen,
    }),
    [
      keys,
      serverKeys,
      serverChecked,
      isReady,
      hydrated,
      updateKeys,
      openKeys,
      keysOpen,
    ],
  );

  return (
    <KeysContext.Provider value={value}>
      {children}
      <ApiKeyModal
        open={keysOpen}
        onOpenChange={setKeysOpen}
        apiKeys={keys}
        onSave={updateKeys}
      />
    </KeysContext.Provider>
  );
}

export function useKeys() {
  const value = useContext(KeysContext);
  if (!value) throw new Error("useKeys must be used inside KeysProvider");
  return value;
}
