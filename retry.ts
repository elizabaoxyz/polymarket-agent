/**
 * Retry utility with exponential backoff for transient API failures.
 */

import { MAX_RETRIES, RETRY_BASE_DELAY_MS } from "./config";

/** Error classes that should trigger a retry */
const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function isTransient(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network errors
    if (msg.includes("econnreset") || msg.includes("econnrefused")) return true;
    if (msg.includes("etimedout") || msg.includes("fetch failed")) return true;
    if (msg.includes("socket hang up") || msg.includes("network")) return true;
    // Rate limit
    if (msg.includes("rate limit") || msg.includes("too many requests")) return true;
    // Check for status code in error
    if ("statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number") {
      return TRANSIENT_STATUS_CODES.has((error as { statusCode: number }).statusCode);
    }
    // Check message for status codes
    for (const code of TRANSIENT_STATUS_CODES) {
      if (msg.includes(String(code))) return true;
    }
  }
  return false;
}

export type RetryOptions = {
  /** Maximum number of retry attempts (default: MAX_RETRIES from config) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: RETRY_BASE_DELAY_MS from config) */
  baseDelayMs?: number;
  /** Optional label for logging */
  label?: string;
  /** Only retry on transient errors (default: true) */
  transientOnly?: boolean;
};

/**
 * Execute an async function with exponential backoff retry.
 * Only retries on transient errors (network, rate limit, 5xx) by default.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const baseDelay = options.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const transientOnly = options.transientOnly ?? true;
  const label = options.label ?? "operation";

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries) break;
      if (transientOnly && !isTransient(error)) break;

      const delay = baseDelay * 2 ** attempt + Math.random() * baseDelay * 0.5;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[retry] ${label} attempt ${attempt + 1}/${maxRetries} failed: ${msg} — retrying in ${Math.round(delay)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
