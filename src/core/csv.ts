import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProcessedLead } from "./types";

const columns: Array<keyof ProcessedLead> = [
  "source",
  "external_id",
  "title",
  "summary",
  "country",
  "region",
  "city",
  "project_address",
  "budget_value",
  "budget_currency",
  "contact_name",
  "contact_email",
  "contact_phone",
  "company_match_score",
  "location_ok",
  "contact_ok",
  "selected_service_types",
  "outreach_channel",
  "message_subject",
  "message_body",
  "url",
  "published_date",
  "scraped_at"
];

function esc(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (!text.includes(",") && !text.includes("\n") && !text.includes('"')) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function needsLeadingNewline(path: string): boolean {
  const size = statSync(path).size;
  if (size === 0) {
    return false;
  }

  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(1);
    readSync(fd, buffer, 0, 1, size - 1);
    return buffer[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

export function writeCsv(path: string, rows: ProcessedLead[], append: boolean): void {
  if (!rows.length) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });

  const fileExists = existsSync(path);
  const writeHeader = !(append && fileExists);
  const rowLines = rows.map((row) => columns.map((k) => esc(row[k])).join(","));

  if (append && fileExists) {
    const prefix = needsLeadingNewline(path) ? "\n" : "";
    appendFileSync(path, `${prefix}${rowLines.join("\n")}\n`, "utf-8");
    return;
  }

  const content = [
    ...(writeHeader ? [columns.join(",")] : []),
    ...rowLines
  ].join("\n");

  writeFileSync(path, `${content}\n`, "utf-8");
}
