# Contributing

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- Node.js >= 18

## Setup

```bash
bun install
cp .env.example .env
# Fill in your API keys in .env
```

## Running

```bash
# Polymarket demo (TUI)
bun run start

# Jupiter demo (TUI)
bun run jupiter

# WebSocket server + web dashboard
bun run web
```

## Testing

```bash
bun test
```

## Linting & Formatting

[Biome](https://biomejs.dev/) enforces code style — strict TypeScript, 2-space indent, double quotes, semicolons.

```bash
bun run lint          # check
bun run lint:fix      # auto-fix
bun run format        # format
bun run typecheck     # tsc --noEmit
```

## Pull Requests

CI runs lint + typecheck + test on every PR. All three must pass before merge.
