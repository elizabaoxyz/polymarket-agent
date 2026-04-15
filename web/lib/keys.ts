"use client";

import type { UserKeys } from "./types";

const STORAGE_KEY = "elizabao-keys";

const REQUIRED_KEYS = ["EVM_PRIVATE_KEY", "CLOB_API_KEY", "CLOB_API_SECRET", "CLOB_API_PASSPHRASE", "POLYMARKET_FUNDER_ADDRESS"];
const LLM_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GROQ_API_KEY", "XAI_API_KEY"];

export function saveKeys(keys: UserKeys): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export function loadKeys(): UserKeys | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearKeys(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function hasRequiredKeys(keys: UserKeys): boolean {
  const hasLlm = LLM_KEYS.some((k) => keys[k]?.trim());
  const hasPolymarket = REQUIRED_KEYS.every((k) => keys[k]?.trim());
  return hasLlm && hasPolymarket;
}
