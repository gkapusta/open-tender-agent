import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { runPipeline } from "../src/core/pipeline";

const originalFetch = globalThis.fetch;
const originalStateDb = process.env.LEADAGENT_STATE_DB;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeConfig(csvPath: string, options: { countryFallback: boolean } = { countryFallback: true }) {
  return {
    company: {
      name: "Pipeline Co",
      website: "https://pipeline.example",
      address: "Main Street 1, Brussels, Belgium",
      language: "en",
      tone: "professional",
      services: "Electrical works, retrofit and maintenance for public tenders"
    },
    sources: {
      enabled: ["TED"],
      ted: {
        days_back: 7,
        country_filter: ["BEL"],
        limit: 1
      }
    },
    matching: {
      radius_km: 100,
      require_contact: false,
      min_match_score: 0
    },
    output: {
      csv_path: csvPath,
      append: true
    },
    geocoding: {
      provider: "nominatim",
      email: "ops@example.com",
      country_fallback: options.countryFallback
    }
  };
}

function tedNotice(id: string, buyerCountry: string) {
  return {
    ND: id,
    PD: "2026-02-10+01:00",
    FT: "Lead text from TED",
    "organisation-name-tenderer": ["Winner Name"],
    "organisation-email-tenderer": ["contact@winner.test"],
    "buyer-country": [buyerCountry],
    "buyer-name": ["Public Buyer"]
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalStateDb === undefined) {
    delete process.env.LEADAGENT_STATE_DB;
  } else {
    process.env.LEADAGENT_STATE_DB = originalStateDb;
  }

  if (originalOpenAIKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
});

describe("runPipeline", () => {
  it("marks seen leads in live mode and skips them on the next run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ota-pipeline-live-"));

    try {
      const configPath = join(dir, "config.yaml");
      const csvPath = join(dir, "out", "leads.csv");
      const dbPath = join(dir, "state.db");

      process.env.LEADAGENT_STATE_DB = dbPath;
      delete process.env.OPENAI_API_KEY;

      writeFileSync(configPath, YAML.stringify(makeConfig(csvPath)), "utf-8");

      let tedCalls = 0;
      let nominatimCalls = 0;

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = getUrl(input);

        if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
          nominatimCalls += 1;
          return new Response(JSON.stringify([{ lat: "50.8503", lon: "4.3517" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        if (url === "https://api.ted.europa.eu/v3/notices/search") {
          tedCalls += 1;
          const payload = JSON.parse(String(init?.body)) as { page?: number };
          const notices = payload.page === 1 ? [tedNotice("TED-LIVE-1", "BE")] : [];

          return new Response(JSON.stringify({ notices }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as typeof fetch;

      const first = await runPipeline({ configPath, dryRun: false, verbose: false });
      const second = await runPipeline({ configPath, dryRun: false, verbose: false });

      expect(first.stats.exported).toBe(1);
      expect(first.stats.seen_skipped).toBe(0);
      expect(first.stats.fetched_by_source).toEqual({ TED: 1 });

      expect(second.stats.exported).toBe(0);
      expect(second.stats.seen_skipped).toBe(1);
      expect(second.stats.fetched_by_source).toEqual({ TED: 1 });

      expect(tedCalls).toBe(2);
      expect(nominatimCalls).toBe(1);

      expect(existsSync(csvPath)).toBe(true);
      const csv = readFileSync(csvPath, "utf-8").trim().split("\n");
      expect(csv).toHaveLength(2);
      expect(csv[1]).toContain("TED-LIVE-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not persist seen state or write CSV during dry-run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ota-pipeline-dry-"));

    try {
      const configPath = join(dir, "config.yaml");
      const csvPath = join(dir, "out", "leads.csv");
      const dbPath = join(dir, "state.db");

      process.env.LEADAGENT_STATE_DB = dbPath;
      delete process.env.OPENAI_API_KEY;

      writeFileSync(configPath, YAML.stringify(makeConfig(csvPath)), "utf-8");

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = getUrl(input);
        if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
          return new Response(JSON.stringify([{ lat: "50.8503", lon: "4.3517" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        if (url === "https://api.ted.europa.eu/v3/notices/search") {
          const payload = JSON.parse(String(init?.body)) as { page?: number };
          const notices = payload.page === 1 ? [tedNotice("TED-DRY-1", "BEL")] : [];

          return new Response(JSON.stringify({ notices }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as typeof fetch;

      const dry = await runPipeline({ configPath, dryRun: true, verbose: false });
      expect(dry.stats.exported).toBe(1);
      expect(existsSync(csvPath)).toBe(false);

      const live = await runPipeline({ configPath, dryRun: false, verbose: false });
      expect(live.stats.exported).toBe(1);
      expect(live.stats.seen_skipped).toBe(0);
      expect(existsSync(csvPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops leads when country fallback cannot match and project address is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ota-pipeline-location-"));

    try {
      const configPath = join(dir, "config.yaml");
      const csvPath = join(dir, "out", "leads.csv");
      const dbPath = join(dir, "state.db");

      process.env.LEADAGENT_STATE_DB = dbPath;
      delete process.env.OPENAI_API_KEY;

      writeFileSync(configPath, YAML.stringify(makeConfig(csvPath, { countryFallback: true })), "utf-8");

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = getUrl(input);
        if (url.startsWith("https://nominatim.openstreetmap.org/search")) {
          return new Response(JSON.stringify([{ lat: "50.8503", lon: "4.3517" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        if (url === "https://api.ted.europa.eu/v3/notices/search") {
          const payload = JSON.parse(String(init?.body)) as { page?: number };
          const notices = payload.page === 1 ? [tedNotice("TED-LOC-1", "DEU")] : [];

          return new Response(JSON.stringify({ notices }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as typeof fetch;

      const result = await runPipeline({ configPath, dryRun: false, verbose: false });

      expect(result.stats.fetched_by_source).toEqual({ TED: 1 });
      expect(result.stats.dropped_location).toBe(1);
      expect(result.stats.exported).toBe(0);
      expect(existsSync(csvPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
