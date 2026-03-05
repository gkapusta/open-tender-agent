# AGENTS.md

## Project Snapshot
- Name: `Open Tender Agent`
- Type: standalone Bun + TypeScript CLI/service package for TED lead discovery and outreach generation
- Goal: keep core logic reusable for serverless, with terminal UX as an interface layer

## Tech Stack
- Bun runtime
- TypeScript (ESM)
- Main deps: `@clack/prompts`, `chalk`, `dotenv`, `yaml`, `zod`
- LLM API: OpenAI Chat Completions (`/v1/chat/completions`)
- Local state: SQLite via `bun:sqlite`

## Directory Map
- `src/core`: domain logic only
  - `config.ts`: Zod config schema + override application
  - `pipeline.ts`: orchestration (fetch -> dedupe -> match -> geocode -> message -> export)
  - `sources/ted.ts`: TED source adapter
  - `sources/index.ts`: source dispatcher (TED-only)
  - `storage.ts`, `geocode.ts`, `matcher.ts`, `message.ts`, `csv.ts`, `openai.ts`
- `src/interfaces`: terminal-facing CLI/TUI
  - `cli.ts`: run command, progress UX, summary rendering
  - `wizard.ts`: interactive setup wizard (quick + advanced)
- `src/app/run.ts`: programmatic entrypoint (`runLeadAgent`) for non-terminal execution
- `tests`: Bun tests

## Runtime Behavior Notes
- `--dry-run` skips CSV/state writes but still performs source fetch + API calls.

## Configuration
- `config.yaml` keys mirror core schema: `company`, `sources`, `matching`, `output`, `geocoding`
- `.env` keys:
  - `OPENAI_API_KEY`
  - `LEADAGENT_MODEL` (optional)
  - `LEADAGENT_MATCH_MODEL` (optional)
  - `LEADAGENT_USER_AGENT` (optional)
  - `LEADAGENT_STATE_DB` (optional)
  - `RESEND_API_KEY`
  - `LEADAGENT_STATUS_EMAIL`
  - `LEADAGENT_FROM_EMAIL`

## Commands
- Install: `bun install`
- Wizard: `bun run src/interfaces/cli.ts wizard`
- Run: `bun run src/interfaces/cli.ts run --config ./config.yaml`
- Dry run: `bun run src/interfaces/cli.ts run --dry-run --verbose`
- Test: `bun test`

## Working Preferences
- Keep `src/core` free of terminal-specific concerns.
- Put all CLI/prompt/visual behavior in `src/interfaces`.
- Preserve source adapter boundaries so fetch backends can be swapped without touching pipeline logic.
- Keep config validation centralized in `src/core/config.ts`.
- Add tests for parsing/normalization when source extractors are changed.
