# Polymarket Agent API Server - Dockerfile
FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install

# Copy source
COPY . .

# Expose port
EXPOSE 3001

# Run API server
CMD ["bun", "run", "api-server.ts"]
