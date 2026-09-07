import type { NextConfig } from "next";

// The acceptance-layer API lives on the WS server. Proxy /v1/* (and the
// console's /api/* feeds) through the web domain so that
// `curl https://elizabao.ai/v1/tasks` is a real, working command.
const WS_HTTP = (process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001")
  .replace(/^wss:/, "https:")
  .replace(/^ws:/, "http:");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${WS_HTTP}/v1/:path*` },
      { source: "/api/trades", destination: `${WS_HTTP}/api/trades` },
      { source: "/api/activity", destination: `${WS_HTTP}/api/activity` },
    ];
  },
};

export default nextConfig;
