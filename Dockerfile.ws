FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY lib.ts runner.ts ws-server.ts tsconfig.json ./
COPY plugins/ ./plugins/

EXPOSE 3001
CMD ["bun", "run", "ws-server.ts"]
