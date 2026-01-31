# Autonomous Trading Integration for ElizaBAO

This guide shows you how to add the AI-powered Autonomous Trading feature to your Lovable elizabao project.

## Files to Add

```
elizabao/
├── supabase/
│   └── functions/
│       └── polymarket-autonomous/     ← NEW
│           └── index.ts
└── src/
    └── components/
        └── autonomous/                 ← NEW
            └── AutonomousTrading.tsx
```

## Step 1: Add the Supabase Edge Function

### Option A: Using Lovable (Recommended)

1. Open your elizabao project in Lovable
2. Ask Lovable: "Create a new Supabase Edge Function called `polymarket-autonomous`"
3. Copy the contents from `supabase-function/polymarket-autonomous/index.ts` into the new function

### Option B: Manual CLI

```bash
# In your elizabao project directory
cd elizabao

# Create the function directory
mkdir -p supabase/functions/polymarket-autonomous

# Copy the function file
cp /path/to/polymarket-agent/integration/supabase-function/polymarket-autonomous/index.ts \
   supabase/functions/polymarket-autonomous/index.ts

# Deploy to Supabase
npx supabase functions deploy polymarket-autonomous
```

## Step 2: Add the React Component

### Option A: Using Lovable (Recommended)

1. In Lovable, ask: "Create a new component at `src/components/autonomous/AutonomousTrading.tsx`"
2. Copy the contents from `components/AutonomousTrading.tsx`

### Option B: Manual

```bash
# Create the directory
mkdir -p src/components/autonomous

# Copy the component
cp /path/to/polymarket-agent/integration/components/AutonomousTrading.tsx \
   src/components/autonomous/AutonomousTrading.tsx
```

## Step 3: Add the Component to Your UI

Add the AutonomousTrading component to your main page or sidebar.

### Example: Add to MainTerminal.tsx

```tsx
import AutonomousTrading from "@/components/autonomous/AutonomousTrading";

// In your component JSX:
<div className="sidebar">
  {/* Existing content */}
  
  {/* Add Autonomous Trading Panel */}
  <AutonomousTrading />
</div>
```

### Example: Add as a new route

```tsx
// In App.tsx, add a new route:
import AutonomousTrading from "@/components/autonomous/AutonomousTrading";

<Route path="/autonomous" element={<AutonomousTrading />} />
```

## Step 4: Configure Environment Variables

In your Supabase dashboard, add these secrets to your Edge Functions:

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for AI analysis | Yes |
| `WALLET_PRIVATE_KEY` | Your Polymarket wallet private key | Yes (for trading) |
| `SUPABASE_URL` | Your Supabase project URL | Auto-set |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Auto-set |

### Adding Secrets via Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **Edge Functions** → **Secrets**
3. Add `OPENAI_API_KEY` with your OpenAI key
4. Add `WALLET_PRIVATE_KEY` with your wallet key (same as in polymarket-actions)

## How It Works

### Scan Flow
```
1. User clicks "Scan" or "Start"
         ↓
2. polymarket-autonomous function fetches active markets from Polymarket API
         ↓
3. Markets are scored based on:
   - Spread (55%) - tighter spreads are better
   - Midpoint (30%) - prices near 50% indicate uncertainty
   - Depth (15%) - more order book depth = better liquidity
         ↓
4. Top opportunities sent to OpenAI for analysis
         ↓
5. AI returns a decision: BUY, SELL, or HOLD
         ↓
6. If auto-execute is ON, trade is placed via polymarket-actions
```

### Risk Levels

| Level | Description |
|-------|-------------|
| **Conservative** | Only trades with <3% spread and >80% AI confidence |
| **Moderate** | Trades with <5% spread and score >0.7 |
| **Aggressive** | Trades any opportunity with score >0.6 |

## Safety Features

- **Daily trade limit**: Prevents over-trading
- **Max order size**: Caps each trade amount
- **Auto-execute toggle**: Must be explicitly enabled
- **Confidence threshold**: AI must have minimum confidence to trade
- **Activity log**: Full transparency of all actions

## Customization

### Change the AI Model

In `polymarket-autonomous/index.ts`, find:
```typescript
model: "gpt-4o-mini",
```

Change to:
- `gpt-4o` for better analysis (more expensive)
- `gpt-3.5-turbo` for faster/cheaper (less accurate)

### Adjust Scoring Weights

```typescript
const SPREAD_WEIGHT = 0.55;   // Importance of tight spreads
const MIDPOINT_WEIGHT = 0.30; // Importance of uncertain markets
const DEPTH_WEIGHT = 0.15;    // Importance of liquidity
```

### Add Market Filters

In the config, add filters for specific market types:
```typescript
allowedMarketTypes: ["politics", "crypto"]
```

## Troubleshooting

### "OpenAI API key not configured"
- Add `OPENAI_API_KEY` to your Supabase Edge Function secrets

### "Failed to initialize trading credentials"
- Ensure `WALLET_PRIVATE_KEY` is set in Supabase secrets
- Make sure the wallet has been used on Polymarket.com at least once

### "Trade failed"
- Check that your wallet has sufficient USDC balance
- Verify CLOB API credentials are working (test with `/wallet` command in chat)

## Support

- GitHub Issues: https://github.com/elizabaoxyz/elizabao/issues
- Twitter: @elizabaoxyz
