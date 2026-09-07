// Client for the elizaBAO acceptance-layer API served by the WS server.

export interface BaoMarket {
  id: string;
  venue: string;
  slug: string;
  title: string;
  rulesUrl: string;
  closeAt: string;
  status: string;
  midYes: number;
  liquidityUsd: number;
  volumeUsd: number;
}

export interface MarketSnapshot {
  snapshotHash: string;
  marketId: string;
  capturedAt: string;
  midYes: number;
  liquidityUsd?: number;
  volumeUsd?: number;
  rawRef: string;
}

export interface BaoTask {
  id: string;
  kind: string;
  marketSlug: string;
  policyUrl: string;
  poolUsdc: string;
  reviewerPoolUsdc: string;
  payoutAsset: string;
  chain: string;
  sponsor: string;
  opensAt: string;
  submitBy: string;
  maxAccepted: number;
  status: string;
  brief: string;
  market?: BaoMarket | null;
}

export interface LedgerRow {
  at: string;
  kind: string;
  refId: string;
  marketId?: string;
  usdc?: string;
  tx?: string;
  publicNote?: string;
}

function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  }
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return "http://localhost:3001";
}

const API_BASE = getApiBase();

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export const fetchMarkets = (limit = 24) => get<BaoMarket[]>(`/v1/markets?limit=${limit}`, []);
export const fetchSnapshot = (slug: string) => get<MarketSnapshot | null>(`/v1/snapshots/${slug}`, null);
export const fetchTasks = () => get<BaoTask[]>("/v1/tasks", []);
export const fetchLedger = () => get<LedgerRow[]>("/v1/ledger", []);
