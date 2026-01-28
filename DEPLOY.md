# Deploying Polymarket Agent API

This guide shows how to deploy the full elizaOS polymarket-agent as a backend service.

## Quick Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/...)

### Manual Steps:

1. **Create a Railway account**: https://railway.app

2. **Create a new project** from GitHub repo

3. **Add environment variables**:
   ```
   OPENAI_API_KEY=sk-...
   EVM_PRIVATE_KEY=0x...
   CLOB_API_KEY=...          (optional, for live trading)
   CLOB_API_SECRET=...       (optional)
   CLOB_API_PASSPHRASE=...   (optional)
   PORT=3001
   ```

4. **Deploy!** Railway will auto-detect the Dockerfile

5. **Get your URL**: Something like `https://your-app.railway.app`

## Deploy to Render

1. Go to https://render.com
2. Create a new **Web Service**
3. Connect your GitHub repo
4. Set:
   - **Build Command**: `bun install`
   - **Start Command**: `bun run api-server.ts`
5. Add environment variables (same as above)

## Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly launch

# Set secrets
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set EVM_PRIVATE_KEY=0x...

# Deploy
fly deploy
```

## Local Development

```bash
# Install dependencies
bun install

# Create .env file
cp .env.example .env
# Edit .env with your keys

# Run API server
bun run api

# Test it
curl http://localhost:3001/api/status
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/api/status` | GET | Agent status |
| `/api/scan` | POST | Scan markets |
| `/api/analyze` | POST | Scan + AI analysis |
| `/api/execute` | POST | Full autonomous cycle |
| `/api/chat` | POST | Chat with agent |

## Connect to elizabao

After deploying, update your elizabao `.env`:

```
VITE_POLYMARKET_AGENT_API=https://your-app.railway.app
```

Then redeploy elizabao via Lovable.

## Features

This API provides the **full elizaOS experience**:

- ✅ Advanced Planning - Multi-step trading strategies
- ✅ Advanced Memory - Remembers past trades
- ✅ Autonomy Service - Continuous thinking loops
- ✅ Polymarket Plugin - Official integration
- ✅ Multiple LLM Support - OpenAI, Anthropic, etc.
