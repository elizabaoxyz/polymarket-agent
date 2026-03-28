import type { GlobalTrade, DashboardStats, WhaleWallet } from "./types";

const DATA_API = "https://data-api.polymarket.com";

export async function getGlobalTrades(limit = 200): Promise<GlobalTrade[]> {
  const res = await fetch(`${DATA_API}/trades?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getWalletTrades(wallet: string, limit = 50): Promise<GlobalTrade[]> {
  const res = await fetch(`${DATA_API}/activity?user=${wallet}&limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

export function computeDashboardStats(trades: GlobalTrade[]): DashboardStats {
  let buyVolume = 0;
  let sellVolume = 0;
  let yesVolume = 0;
  let noVolume = 0;
  let largestBuy = 0;
  let largestSell = 0;
  const walletMap = new Map<string, WhaleWallet>();

  for (const t of trades) {
    const vol = t.usdcSize ?? t.size * t.price;
    if (t.side === "BUY") {
      buyVolume += vol;
      if (vol > largestBuy) largestBuy = vol;
    } else {
      sellVolume += vol;
      if (vol > largestSell) largestSell = vol;
    }
    if (t.outcome === "Yes") yesVolume += vol;
    else noVolume += vol;

    const existing = walletMap.get(t.proxyWallet);
    if (existing) {
      existing.totalVolume += vol;
      existing.tradeCount += 1;
      if (t.side === "BUY") existing.buyVolume += vol;
      else existing.sellVolume += vol;
    } else {
      walletMap.set(t.proxyWallet, {
        address: t.proxyWallet,
        name: t.name || t.proxyWallet.slice(0, 8),
        pseudonym: t.pseudonym || "",
        totalVolume: vol,
        tradeCount: 1,
        buyVolume: t.side === "BUY" ? vol : 0,
        sellVolume: t.side === "SELL" ? vol : 0,
      });
    }
  }

  const whales = Array.from(walletMap.values())
    .filter((w) => w.totalVolume > 1000)
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 15);

  const totalVolume = buyVolume + sellVolume;
  return {
    volume24h: totalVolume,
    transactions: trades.length,
    whaleCount: whales.length,
    avgTradeSize: trades.length > 0 ? totalVolume / trades.length : 0,
    buyVolume,
    sellVolume,
    yesVolume,
    noVolume,
    largestBuy,
    largestSell,
    whales,
  };
}
