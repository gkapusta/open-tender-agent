import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fetchWithTimeout } from "./http";
import type { RunResult } from "./types";
import type { Logger } from "./logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 30_000;

function toSafeBase64(data: Buffer): string {
  return data.toString("base64");
}

function toCsvFilename(path: string): string {
  const base = basename(path);
  return base.endsWith(".csv") ? base : `${base}.csv`;
}

function buildSummaryText(result: RunResult, logSnippet: string, dryRun: boolean): string {
  const stats = result.stats;
  return [
    `LeadAgent run summary`,
    ``,
    `Mode: ${dryRun ? "DRY RUN" : "LIVE"}`,
    `Fetched: ${JSON.stringify(stats.fetched_by_source)}`,
    `Already seen: ${stats.seen_skipped}`,
    `Dropped (low score): ${stats.dropped_low_score}`,
    `Dropped (no contact): ${stats.dropped_no_contact}`,
    `Dropped (location): ${stats.dropped_location}`,
    `Exported: ${stats.exported}`,
    `CSV: ${result.outputCsvPath}`,
    ``,
    `Log tail (latest):`,
    logSnippet || "(no log output captured)"
  ].join("\n");
}

interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

async function sendResendEmail(payload: Record<string, unknown>, apiKey: string): Promise<void> {
  if (!apiKey) {
    throw new Error("RESEND_API_KEY missing");
  }
  const response = await fetchWithTimeout(
    RESEND_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    RESEND_TIMEOUT_MS
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error ${response.status}: ${body}`);
  }
}

export async function sendResendLeadsEmail(
  to: string,
  from: string,
  csvPath: string,
  result: RunResult,
  dryRun: boolean,
  apiKey: string,
  logger?: Logger
): Promise<void> {
  const csvBuffer = readFileSync(csvPath);
  const payload = {
    from,
    to,
    subject: `LeadAgent leads (${result.stats.exported} leads)`,
    text: `Attached is the latest leads CSV. Exported ${result.stats.exported} lead(s). Mode: ${
      dryRun ? "DRY RUN" : "LIVE"
    }.`,
    attachments: [
      {
        filename: toCsvFilename(csvPath),
        content: toSafeBase64(csvBuffer),
        contentType: "text/csv"
      }
    ]
  };

  logger?.info(`Resend: sending leads email to ${to}`);
  await sendResendEmail(payload, apiKey);
}

export async function sendResendStatusEmail(
  to: string,
  from: string,
  result: RunResult,
  logSnippet: string,
  dryRun: boolean,
  apiKey: string,
  attachment?: EmailAttachment,
  logger?: Logger
): Promise<void> {
  const attachments = attachment ? [attachment] : undefined;
  const payload = {
    from,
    to,
    subject: `LeadAgent status (${result.stats.exported} exported)`,
    text: buildSummaryText(result, logSnippet, dryRun),
    ...(attachments ? { attachments } : {})
  };

  logger?.info(`Resend: sending status email to ${to}`);
  await sendResendEmail(payload, apiKey);
}
