# Polymarket Agent API Server - Dockerfile
FROM oven/bun:1.1

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Expose port
EXPOSE 3001

# Run API server
CMD ["bun", "run", "api-server.ts"]
