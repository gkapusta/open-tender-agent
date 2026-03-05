# Open Tender Agent (for [TED](https://ted.europa.eu/))

Open-source Bun + TypeScript CLI for EU public-procurement lead discovery and outreach generation.

This OSS edition supports a single source:
- TED (`api.ted.europa.eu`)

## Highlights

- Bun runtime + strict TypeScript
- Core pipeline reusable outside the terminal interface
- Interactive setup wizard + CLI run mode
- Config validation with Zod
- Optional delivery emails via Resend

## Project layout

- `src/core`: domain logic and orchestration
- `src/interfaces`: terminal CLI and setup wizard
- `tests`: Bun tests

## Requirements

- Bun 1.1+
- OpenAI API key
- Nominatim-compatible contact email for geocoding

## Setup

```bash
bun install
cp .env.example .env
cp config.example.yaml config.yaml
```

Or run the interactive wizard:

```bash
bun run src/interfaces/cli.ts wizard
```

## Usage

```bash
# Dry run
bun run src/interfaces/cli.ts run --config ./config.yaml --dry-run --verbose

# Live run
bun run src/interfaces/cli.ts run --config ./config.yaml

# Optional TED overrides
bun run src/interfaces/cli.ts run --sources TED --since 14d --limit 300 --min-score 0.6 --radius-km 150
```

## Environment variables

Required:
- `OPENAI_API_KEY`

Optional:
- `LEADAGENT_MODEL`
- `LEADAGENT_MATCH_MODEL`
- `LEADAGENT_USER_AGENT`
- `LEADAGENT_STATE_DB`
- `RESEND_API_KEY`
- `LEADAGENT_STATUS_EMAIL`
- `LEADAGENT_FROM_EMAIL`

## Programmatic usage

```ts
import { runLeadAgent } from "./src/app/run";

const result = await runLeadAgent({
  configPath: "./config.yaml",
  dryRun: true,
  verbose: true
});
```

## License

MIT. See `LICENSE`.
