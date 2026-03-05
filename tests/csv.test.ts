import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCsv } from "../src/core/csv";
import type { ProcessedLead } from "../src/core/types";

function row(id: string): ProcessedLead {
  return {
    source: "TED",
    external_id: id,
    title: `Title ${id}`,
    summary: "Summary",
    country: "BEL",
    region: "Brussels",
    city: "Brussels",
    project_address: "Main Street 1, Brussels, Belgium",
    budget_value: 1000,
    budget_currency: "EUR",
    contact_name: "Contact",
    contact_email: "contact@example.com",
    contact_phone: "+32 123",
    company_match_score: 0.8,
    location_ok: true,
    contact_ok: true,
    selected_service_types: "Electrical Works",
    outreach_channel: "email",
    message_subject: "Subject",
    message_body: "Body",
    url: "https://example.com",
    published_date: "2026-02-18",
    scraped_at: "2026-02-18T00:00:00.000Z"
  };
}

describe("writeCsv", () => {
  it("appends rows without duplicating header", () => {
    const dir = mkdtempSync(join(tmpdir(), "ota-csv-"));

    try {
      const path = join(dir, "out", "leads.csv");

      writeCsv(path, [row("A")], true);
      writeCsv(path, [row("B")], true);

      expect(existsSync(path)).toBe(true);
      const lines = readFileSync(path, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]?.startsWith("source,external_id")).toBe(true);
      expect(lines[1]).toContain(",A,");
      expect(lines[2]).toContain(",B,");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends correctly even if existing file has no trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "ota-csv-no-nl-"));

    try {
      const path = join(dir, "out", "leads.csv");
      mkdirSync(join(dir, "out"), { recursive: true });
      const header =
        "source,external_id,title,summary,country,region,city,project_address,budget_value,budget_currency,contact_name,contact_email,contact_phone,company_match_score,location_ok,contact_ok,selected_service_types,outreach_channel,message_subject,message_body,url,published_date,scraped_at";
      const existing = `${header}\nTED,EXISTING,Title,Summary,BEL,Brussels,Brussels,,100,EUR,Name,email@test,,0.7,true,true,Electrical,email,Subject,Body,,2026-02-18,2026-02-18T00:00:00.000Z`;
      writeFileSync(path, existing, "utf-8");

      writeCsv(path, [row("NEW")], true);

      const lines = readFileSync(path, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("EXISTING");
      expect(lines[2]).toContain(",NEW,");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
