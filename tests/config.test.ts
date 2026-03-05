import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { applyOverrides, loadConfig } from "../src/core/config";

function makeBaseConfig() {
  return {
    company: {
      name: "Test Company",
      website: "https://example.com",
      address: "Main Street 1, Brussels, Belgium",
      language: "en",
      tone: "professional",
      services: "Electrical works and HVAC installation for public projects"
    },
    sources: {
      enabled: ["TED"],
      ted: {
        days_back: 7,
        country_filter: ["BEL"],
        limit: 200
      }
    },
    matching: {
      radius_km: 100,
      require_contact: true,
      min_match_score: 0.55
    },
    output: {
      csv_path: "./out/leads.csv",
      append: true,
      leads_email: ""
    },
    geocoding: {
      provider: "nominatim",
      email: "ops@example.com",
      country_fallback: true
    }
  };
}

function withTempConfig(configObj: Record<string, unknown>, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ota-config-"));
  const path = join(dir, "config.yaml");

  try {
    writeFileSync(path, YAML.stringify(configObj), "utf-8");
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("config", () => {
  it("loads valid config and normalizes blank optional leads_email", () => {
    withTempConfig(makeBaseConfig(), (path) => {
      const loaded = loadConfig(path);

      expect(loaded.sources.enabled).toEqual(["TED"]);
      expect(loaded.output.leads_email).toBeUndefined();
      expect(loaded.sources.ted.days_back).toBe(7);
    });
  });

  it("normalizes lowercase country filters to ISO3 uppercase", () => {
    const config = makeBaseConfig();
    config.sources.ted.country_filter = ["beL", "deu"];

    withTempConfig(config, (path) => {
      const loaded = loadConfig(path);
      expect(loaded.sources.ted.country_filter).toEqual(["BEL", "DEU"]);
    });
  });

  it("rejects invalid country filter values", () => {
    const config = makeBaseConfig();
    config.sources.ted.country_filter = ["BEL", "B3L"];

    withTempConfig(config, (path) => {
      expect(() => loadConfig(path)).toThrow("Country codes must be ISO3 values");
    });
  });

  it("rejects unsupported language values", () => {
    const config = makeBaseConfig();
    config.company.language = "xx";

    withTempConfig(config, (path) => {
      expect(() => loadConfig(path)).toThrow("Unsupported language");
    });
  });

  it("applies overrides without mutating the original config", () => {
    withTempConfig(makeBaseConfig(), (path) => {
      const loaded = loadConfig(path);

      const updated = applyOverrides(loaded, {
        since_days: 14,
        limit: 350,
        min_score: 0.7,
        radius_km: 180,
        language: "nl",
        tone: "formal",
        sources_enabled: ["TED"]
      });

      expect(updated.sources.ted.days_back).toBe(14);
      expect(updated.sources.ted.limit).toBe(350);
      expect(updated.matching.min_match_score).toBe(0.7);
      expect(updated.matching.radius_km).toBe(180);
      expect(updated.company.language).toBe("nl");
      expect(updated.company.tone).toBe("formal");
      expect(updated.sources.enabled).toEqual(["TED"]);

      expect(loaded.sources.ted.days_back).toBe(7);
      expect(loaded.sources.ted.limit).toBe(200);
      expect(loaded.matching.min_match_score).toBe(0.55);
      expect(loaded.company.language).toBe("en");
      expect(loaded.company.tone).toBe("professional");
    });
  });

  it("rejects invalid override values", () => {
    withTempConfig(makeBaseConfig(), (path) => {
      const loaded = loadConfig(path);

      expect(() => applyOverrides(loaded, { min_score: 1.1 })).toThrow();
      expect(() => applyOverrides(loaded, { since_days: 0 })).toThrow();
    });
  });
});
