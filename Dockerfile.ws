FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY lib.ts runner.ts ws-server.ts tsconfig.json ./
COPY config.ts retry.ts mutex.ts portfolio.ts portfolio-types.ts solana-wallet.ts market-intel.ts ./
COPY autonomy.ts autonomy-state.ts autonomy-llm.ts autonomy-scanner.ts autonomy-trade.ts autonomy-sell.ts autonomy-rag.ts ./
COPY plugins/ ./plugins/

EXPOSE 3001
CMD ["bun", "run", "ws-server.ts"]
