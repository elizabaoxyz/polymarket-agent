/**
 * HTTP Proxy Configuration for Polymarket API
 * Bypasses Cloudflare blocks by routing requests through a proxy server
 */

import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

// Proxy configuration from environment
const PROXY_HOST = process.env.HTTP_PROXY_HOST || "";
const PROXY_PORT = process.env.HTTP_PROXY_PORT || "";
const PROXY_USER = process.env.HTTP_PROXY_USER || "";
const PROXY_PASS = process.env.HTTP_PROXY_PASS || "";

let proxyConfigured = false;

/**
 * Configure axios to use HTTP proxy globally
 * This affects all axios requests including those from @polymarket/clob-client
 */
export function configureHttpProxy(): boolean {
  if (proxyConfigured) return true;
  
  if (!PROXY_HOST || !PROXY_PORT) {
    console.log("⚠️ HTTP proxy not configured (no HTTP_PROXY_HOST/PORT in env)");
    return false;
  }

  try {
    // Build proxy URL with auth
    let proxyUrl = `http://`;
    if (PROXY_USER && PROXY_PASS) {
      proxyUrl += `${PROXY_USER}:${PROXY_PASS}@`;
    }
    proxyUrl += `${PROXY_HOST}:${PROXY_PORT}`;

    // Create HTTPS proxy agent
    const httpsAgent = new HttpsProxyAgent(proxyUrl);

    // Configure axios defaults
    axios.defaults.httpsAgent = httpsAgent;
    axios.defaults.proxy = false; // Disable axios built-in proxy, use agent instead

    // Also patch global fetch if needed (Bun/Node)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      // For now, only use proxy for polymarket.com requests
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("polymarket.com")) {
        // Use axios for proxied requests
        try {
          const method = init?.method || "GET";
          const headers = init?.headers as Record<string, string> || {};
          const response = await axios({
            url,
            method,
            headers,
            data: init?.body,
            httpsAgent,
            validateStatus: () => true, // Don't throw on non-2xx
          });
          
          return new Response(JSON.stringify(response.data), {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers as any),
          });
        } catch (err: any) {
          console.error(`Proxied fetch error: ${err.message}`);
          throw err;
        }
      }
      // Non-polymarket requests go through normal fetch
      return originalFetch(input, init);
    };

    proxyConfigured = true;
    console.log(`✅ HTTP Proxy configured: ${PROXY_HOST}:${PROXY_PORT}`);
    console.log(`🌍 Requests will route through Romania proxy`);
    
    return true;
  } catch (err: any) {
    console.error(`❌ Failed to configure HTTP proxy: ${err.message}`);
    return false;
  }
}

/**
 * Test if proxy is working by making a test request
 */
export async function testProxyConnection(): Promise<boolean> {
  if (!proxyConfigured) {
    console.log("⚠️ Proxy not configured, skipping test");
    return false;
  }

  try {
    console.log("🧪 Testing proxy connection...");
    const response = await axios.get("https://api.ipify.org?format=json", {
      timeout: 10000,
    });
    console.log(`✅ Proxy test passed! IP: ${response.data.ip}`);
    return true;
  } catch (err: any) {
    console.error(`❌ Proxy test failed: ${err.message}`);
    return false;
  }
}

export function isProxyConfigured(): boolean {
  return proxyConfigured;
}

export function getProxyInfo(): { host: string; port: string; configured: boolean } {
  return {
    host: PROXY_HOST,
    port: PROXY_PORT,
    configured: proxyConfigured,
  };
}
