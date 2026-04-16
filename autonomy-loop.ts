/**
 * Autonomy lifecycle — public API, heartbeat management, timer scheduling.
 * Delegates cycle orchestration to autonomy.ts.
 */

import { runAutonomyCycle } from "./autonomy";
import {
  type AutonomyCallbacks,
  type AutonomyDeps,
  type AutonomyHandle,
  type AutonomyPlatform,
  createState,
} from "./autonomy-state";
import { AUTONOMY_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_MAX_FAILURES } from "./config";
import { log } from "./log";
import type { PolymarketExtService } from "./plugins/polymarket-ext/service";
import { POLYMARKET_EXT_SERVICE_TYPE } from "./plugins/polymarket-ext/types";
import type { X402SolanaService } from "./plugins/x402-solana/service";
import { X402_SERVICE_TYPE } from "./plugins/x402-solana/types";

// Re-export public types for consumers
export type { AutonomyCallbacks, AutonomyDeps, AutonomyHandle, AutonomyPlatform };

/**
 * Start the autonomy loop. Returns a handle to stop it.
 */
export function startAutonomy(
  deps: AutonomyDeps,
  callbacks: AutonomyCallbacks,
  platform: AutonomyPlatform = "both",
): AutonomyHandle {
  const state = createState(platform);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = true;

  // Start heartbeat (only needed for Polymarket GTC orders)
  if (platform !== "jupiter")
    (async () => {
      try {
        const extSvc = (await deps.runtime.getServiceLoadPromise(
          POLYMARKET_EXT_SERVICE_TYPE,
        )) as unknown as PolymarketExtService;
        if (extSvc?.clob) {
          extSvc.clob.resetHeartbeat();
          extSvc.clob.heartbeat().catch(() => {});
          let consecutiveFailures = 0;
          heartbeatTimer = setInterval(() => {
            extSvc
              .clob!.heartbeat()
              .then(() => {
                if (consecutiveFailures > 0) {
                  callbacks.send({
                    type: "action_result",
                    text: `[HEARTBEAT] ✅ Recovered after ${consecutiveFailures} failures`,
                  });
                  consecutiveFailures = 0;
                }
              })
              .catch((err) => {
                consecutiveFailures++;
                const errMsg = err instanceof Error ? err.message : String(err);
                log.warn("autonomy", `heartbeat failed (${consecutiveFailures}x): ${errMsg}`);
                if (consecutiveFailures >= HEARTBEAT_MAX_FAILURES) {
                  callbacks.send({
                    type: "action_result",
                    text: `[HEARTBEAT] ⚠️ ${consecutiveFailures} consecutive failures — GTC orders at risk of auto-cancel! Error: ${errMsg}`,
                  });
                }
              });
          }, HEARTBEAT_INTERVAL_MS);
          callbacks.send({
            type: "action_result",
            text: "[AUTONOMY] Heartbeat started — GTC orders protected",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("autonomy", `Heartbeat init failed: ${msg} — GTC orders may auto-cancel`);
        callbacks.send({
          type: "action_result",
          text: `[AUTONOMY] ⚠️ Heartbeat failed to start: ${msg} — GTC orders at risk`,
        });
      }
    })();

  // x402 status
  (async () => {
    try {
      const x402Svc = (await deps.runtime.getServiceLoadPromise(
        X402_SERVICE_TYPE,
      )) as unknown as X402SolanaService | null;
      if (x402Svc?.isActive()) {
        globalThis.fetch = x402Svc.getWrappedFetch();
        callbacks.send({
          type: "action_result",
          text: `[AUTONOMY] x402 payments active — cap: $${x402Svc.getMaxPaymentUsd().toFixed(2)}/request`,
        });
      } else {
        callbacks.send({
          type: "action_result",
          text: "[AUTONOMY] x402 payments disabled — set SOLANA_PRIVATE_KEY + X402_ENABLED=true to enable",
        });
      }
    } catch {}
  })();

  const IDLE_MULTIPLIER = 5;
  const runCycleSafely = async () => {
    try {
      await runAutonomyCycle(deps, callbacks, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("autonomy", `cycle crashed: ${msg}`);
      try {
        callbacks.send({
          type: "action_result",
          text: `[AUTONOMY] Cycle error: ${msg}`,
        });
      } catch {}
      try {
        callbacks.send({ type: "thinking", active: false });
      } catch {}
    }
  };
  const scheduleNext = () => {
    if (!running) return;
    const interval =
      state.idleCycles >= 3 ? AUTONOMY_INTERVAL_MS * IDLE_MULTIPLIER : AUTONOMY_INTERVAL_MS;
    timer = setTimeout(() => {
      void runCycleSafely().finally(scheduleNext);
    }, interval);
  };
  void runCycleSafely().finally(scheduleNext);

  return {
    get isRunning() {
      return running;
    },
    get platform() {
      return platform;
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
  };
}
