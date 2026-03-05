#!/usr/bin/env bun
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename } from "node:path";
import "dotenv/config";
import { intro, outro, spinner, note } from "@clack/prompts";
import chalk from "chalk";
import { runPipeline } from "../core/pipeline";
import type { RunOverrides, SourceName } from "../core/types";
import { applyOverrides, loadConfig } from "../core/config";
import { sendResendLeadsEmail, sendResendStatusEmail } from "../core/email";
import { runWizard } from "./wizard";

interface CliArgs {
  command: "run" | "wizard";
  config: string;
  env: string;
  csv?: string;
  noAppend: boolean;
  dryRun: boolean;
  verbose: boolean;
  sources?: SourceName[];
  sinceDays?: number;
  limit?: number;
  minScore?: number;
  radiusKm?: number;
  language?: string;
  tone?: string;
}

const STAGE_LABELS: Record<string, string> = {
  load_config: "Load config",
  geocode_company: "Geocode company",
  fetch_sources: "Fetch sources",
  process: "Process leads",
  export: "Export results"
};

function requireValue(list: string[], i: number, flag: string): string {
  const value = list[i + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseFiniteNumber(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${flag}: ${raw}`);
  }
  return value;
}

function parsePositiveInt(raw: string, flag: string): number {
  const value = parseFiniteNumber(raw, flag);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseUnitInterval(raw: string, flag: string): number {
  const value = parseFiniteNumber(raw, flag);
  if (value < 0 || value > 1) {
    throw new Error(`${flag} must be between 0 and 1`);
  }
  return value;
}

function parseNonNegative(raw: string, flag: string): number {
  const value = parseFiniteNumber(raw, flag);
  if (value < 0) {
    throw new Error(`${flag} must be non-negative`);
  }
  return value;
}

function parseSinceDays(raw: string): number {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d+)(d)?$/i);
  if (!match) {
    throw new Error("--since must be a positive integer, optionally with 'd' suffix (e.g. 14 or 14d)");
  }
  return parsePositiveInt(match[1], "--since");
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "run",
    config: "./config.yaml",
    env: ".env",
    noAppend: false,
    dryRun: false,
    verbose: false
  };

  const list = [...argv];
  const first = list[0];
  if (first === "run" || first === "wizard") {
    args.command = first;
    list.shift();
  }

  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];

    if (token === "--config") {
      args.config = requireValue(list, i, token);
      i += 1;
    } else if (token === "--env") {
      args.env = requireValue(list, i, token);
      i += 1;
    } else if (token === "--csv") {
      args.csv = requireValue(list, i, token);
      i += 1;
    } else if (token === "--no-append") {
      args.noAppend = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--verbose" || token === "-v") {
      args.verbose = true;
    } else if (token === "--sources") {
      const values: string[] = [];
      while (list[i + 1] && !list[i + 1].startsWith("--")) {
        values.push(list[++i]);
      }
      if (!values.length) {
        throw new Error("--sources requires at least one source name");
      }
      const parsed = values.map((v) => v.toUpperCase()).filter((v): v is SourceName => v === "TED");
      if (!parsed.length) {
        throw new Error(`Unsupported source values: ${values.join(", ")}. Supported sources: TED`);
      }
      args.sources = parsed;
    } else if (token === "--since") {
      const raw = requireValue(list, i, token);
      args.sinceDays = parseSinceDays(raw);
      i += 1;
    } else if (token === "--limit") {
      const raw = requireValue(list, i, token);
      args.limit = parsePositiveInt(raw, token);
      i += 1;
    } else if (token === "--min-score") {
      const raw = requireValue(list, i, token);
      args.minScore = parseUnitInterval(raw, token);
      i += 1;
    } else if (token === "--radius-km") {
      const raw = requireValue(list, i, token);
      args.radiusKm = parseNonNegative(raw, token);
      i += 1;
    } else if (token === "--language") {
      args.language = requireValue(list, i, token);
      i += 1;
    } else if (token === "--tone") {
      args.tone = requireValue(list, i, token);
      i += 1;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }

  return args;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function logVerbose(kind: "stage" | "info", message: string): void {
  const color = kind === "stage" ? chalk.cyan : chalk.gray;
  console.log(`${chalk.dim(stamp())} ${color(`[${kind}]`)} ${message}`);
}

function readLogTail(path: string, maxBytes = 200_000): string {
  if (!path || !existsSync(path)) return "";
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, start);
      return buffer.toString("utf-8").trim();
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

async function maybeSendResendEmails(
  result: Awaited<ReturnType<typeof runPipeline>>,
  configPath: string,
  overrides: RunOverrides,
  dryRun: boolean,
  verbose: boolean
): Promise<void> {
  const logInfo = (message: string) => {
    if (verbose) logVerbose("info", message);
  };

  const resendKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const fromEmail = process.env.LEADAGENT_FROM_EMAIL?.trim() ?? "";
  const statusEmail = process.env.LEADAGENT_STATUS_EMAIL?.trim() ?? "";
  const logPath = process.env.LEADAGENT_LOG_FILE?.trim() ?? "";
  const logSnippet = readLogTail(logPath);
  const maxLogAttachmentBytes = 1_000_000;
  let logAttachment:
    | {
        filename: string;
        content: string;
        contentType: string;
      }
    | undefined;

  if (logPath && existsSync(logPath)) {
    try {
      const size = statSync(logPath).size;
      if (size > maxLogAttachmentBytes) {
        logInfo(`Resend: log file too large to attach (${size} bytes), sending tail only`);
      } else if (size > 0) {
        const data = readFileSync(logPath);
        logAttachment = {
          filename: basename(logPath),
          content: data.toString("base64"),
          contentType: "text/plain"
        };
      }
    } catch (error) {
      logInfo(`Resend: failed to read log file (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (!resendKey) {
    logInfo("Resend: RESEND_API_KEY not set, skipping email delivery");
    return;
  }
  if (!fromEmail) {
    logInfo("Resend: LEADAGENT_FROM_EMAIL not set, skipping email delivery");
    return;
  }

  let leadsEmail = "";
  try {
    const config = applyOverrides(loadConfig(configPath), overrides);
    leadsEmail = config.output.leads_email?.trim() ?? "";
  } catch (error) {
    logInfo(`Resend: failed to load config for leads email (${error instanceof Error ? error.message : String(error)})`);
  }

  if (statusEmail) {
    try {
      await sendResendStatusEmail(statusEmail, fromEmail, result, logSnippet, dryRun, resendKey, logAttachment);
      logInfo(`Resend: status email sent to ${statusEmail}`);
    } catch (error) {
      logInfo(`Resend: status email failed (${error instanceof Error ? error.message : String(error)})`);
    }
  } else {
    logInfo("Resend: LEADAGENT_STATUS_EMAIL not set, skipping status email");
  }

  if (dryRun) {
    logInfo("Resend: dry run mode, skipping leads CSV email");
    return;
  }

  if (!leadsEmail) {
    logInfo("Resend: output.leads_email not set, skipping leads email");
    return;
  }

  if (!existsSync(result.outputCsvPath)) {
    logInfo(`Resend: CSV not found at ${result.outputCsvPath}, skipping leads email`);
    return;
  }

  if (result.stats.exported === 0) {
    logInfo("Resend: no exported leads, skipping leads email");
    return;
  }

  try {
    await sendResendLeadsEmail(leadsEmail, fromEmail, result.outputCsvPath, result, dryRun, resendKey);
    logInfo(`Resend: leads email sent to ${leadsEmail}`);
  } catch (error) {
    logInfo(`Resend: leads email failed (${error instanceof Error ? error.message : String(error)})`);
  }
}

function printRows(result: Awaited<ReturnType<typeof runPipeline>>): void {
  if (!result.rows.length) {
    note("No leads matched the criteria.", "Results");
    return;
  }

  const lines = result.rows.slice(0, 20).map((r) => {
    const score = chalk.green(r.company_match_score.toFixed(3));
    return `${chalk.cyan(r.source)} ${chalk.white(r.external_id.slice(0, 20))} score=${score} contact=${r.contact_ok ? "yes" : "no"}`;
  });

  note(lines.join("\n"), `Top ${Math.min(20, result.rows.length)} results`);
}

function printSummary(result: Awaited<ReturnType<typeof runPipeline>>, dryRun: boolean): void {
  const stats = result.stats;
  const summary = [
    `Fetched: ${JSON.stringify(stats.fetched_by_source)}`,
    `Already seen: ${stats.seen_skipped}`,
    `Dropped (low score): ${stats.dropped_low_score}`,
    `Dropped (no contact): ${stats.dropped_no_contact}`,
    `Dropped (location): ${stats.dropped_location}`,
    `Exported: ${stats.exported}`,
    `CSV: ${result.outputCsvPath}`,
    dryRun ? "Mode: DRY RUN" : "Mode: LIVE"
  ].join("\n");

  note(summary, "Summary");
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(Bun.argv.slice(2));
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  if (args.command === "wizard") {
    await runWizard(args.config, args.env);
    return;
  }

  intro(chalk.cyan("Open Tender Agent"));

  if (!existsSync(args.config)) {
    outro(chalk.red(`Config not found at ${args.config}. Run wizard: bun run src/interfaces/cli.ts wizard`));
    process.exit(1);
  }

  const overrides: RunOverrides = {
    sources_enabled: args.sources,
    since_days: args.sinceDays,
    limit: args.limit,
    min_score: args.minScore,
    radius_km: args.radiusKm,
    language: args.language,
    tone: args.tone
  };

  const spin = spinner();
  if (!args.verbose) {
    spin.start(args.dryRun ? "Running pipeline (dry-run)" : "Running pipeline");
  } else {
    note(args.dryRun ? "Running pipeline in dry-run mode" : "Running pipeline in live mode", "Verbose");
  }

  try {
    const result = await runPipeline(
      {
        configPath: args.config,
        csvPath: args.csv,
        append: !args.noAppend,
        dryRun: args.dryRun,
        verbose: args.verbose,
        overrides
      },
      {
        onStage: (stage) => {
          const label = STAGE_LABELS[stage] ?? stage;
          if (args.verbose) {
            logVerbose("stage", label);
          } else {
            spin.message(`Stage: ${label}`);
          }
        },
        onInfo: (msg) => {
          if (args.verbose) {
            logVerbose("info", msg);
          }
        }
      }
    );

    if (!args.verbose) {
      spin.stop(chalk.green("Pipeline completed"));
    } else {
      logVerbose("stage", "Pipeline completed");
    }

    printRows(result);
    printSummary(result, args.dryRun);
    await maybeSendResendEmails(result, args.config, overrides, args.dryRun, args.verbose);
    outro(chalk.green("Done"));
  } catch (error) {
    if (!args.verbose) {
      spin.stop(chalk.red("Pipeline failed"));
    } else {
      logVerbose("stage", "Pipeline failed");
    }
    outro(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
