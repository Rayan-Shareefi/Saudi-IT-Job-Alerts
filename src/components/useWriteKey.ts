"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The key that authorises write actions from the browser, remembered per browser.
 *
 * Removing, saving, deciding a review and starting a collection run all write
 * to the database or spend quota, and the site is readable by anyone with the
 * link. The key is typed once and kept locally rather than compiled into the
 * page - a NEXT_PUBLIC_ variable would ship it to every visitor and gate
 * nothing at all. Sent as `x-removal-secret`; checked by `isAuthorised`.
 *
 * One storage slot shared by every component, so typing it once anywhere is
 * enough everywhere.
 */
export const WRITE_KEY_STORAGE = "sja:removal-key:v1";

export function readWriteKey(): string | null {
  try {
    return localStorage.getItem(WRITE_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function storeWriteKey(key: string): void {
  try {
    localStorage.setItem(WRITE_KEY_STORAGE, key);
  } catch {
    /* not persisted; still usable for this session */
  }
}

export function forgetWriteKey(): void {
  try {
    localStorage.removeItem(WRITE_KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
}

/** The stored key, or ask for it once and remember it. Null if declined. */
export function writeKeyOrPrompt(purpose = "this action"): string | null {
  const existing = readWriteKey();
  if (existing) return existing;
  const typed = window.prompt(
    `Editing key for ${purpose} (the REMOVAL_SECRET or CRON_SECRET value). It is stored in this browser only.`,
  );
  if (!typed?.trim()) return null;
  storeWriteKey(typed.trim());
  return typed.trim();
}

/** React state view of the same slot. */
export function useWriteKey(): [string | null, (k: string) => void, () => void] {
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    setKey(readWriteKey());
  }, []);

  const save = useCallback((k: string) => {
    setKey(k);
    storeWriteKey(k);
  }, []);

  const forget = useCallback(() => {
    setKey(null);
    forgetWriteKey();
  }, []);

  return [key, save, forget];
}
