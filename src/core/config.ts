import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { getLanguageCodes, MESSAGE_TONES } from "./languages";
import type { Config, RunOverrides } from "./types";

const languageCodes = getLanguageCodes();
const toneValues = MESSAGE_TONES.map((t) => t.value.toLowerCase());

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().email().optional()
);

const iso3CountryCode = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), {
    message: "Country codes must be ISO3 values (e.g., BEL, DEU, FRA)"
  });

const configSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    website: z.string().url(),
    address: z.string().min(5),
    language: z.string().refine((v) => languageCodes.includes(v.toLowerCase()), {
      message: `Unsupported language. Supported: ${languageCodes.join(", ")}`
    }),
    tone: z.string().refine((v) => toneValues.includes(v.toLowerCase()), {
      message: `Unsupported tone. Supported: ${toneValues.join(", ")}`
    }),
    services: z.string().min(10)
  }),
  sources: z.object({
    enabled: z.array(z.enum(["TED"]).catch("TED")).min(1),
    ted: z.object({
      days_back: z.number().int().min(1).max(365).default(7),
      country_filter: z.array(iso3CountryCode).default([]),
      limit: z.number().int().min(1).max(10_000).default(200)
    })
  }),
  matching: z.object({
    radius_km: z.number().min(0).default(100),
    require_contact: z.boolean().default(true),
    min_match_score: z.number().min(0).max(1).default(0.55)
  }),
  output: z.object({
    csv_path: z.string().default("./out/leads.csv"),
    append: z.boolean().default(true),
    leads_email: optionalEmail
  }),
  geocoding: z.object({
    provider: z.literal("nominatim").default("nominatim"),
    email: z.string().email(),
    country_fallback: z.boolean().default(true)
  })
});

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf-8");
  const parsed = YAML.parse(raw);
  return configSchema.parse(parsed) as Config;
}

export function applyOverrides(config: Config, overrides: RunOverrides = {}): Config {
  const next: Config = structuredClone(config);

  if (overrides.sources_enabled) {
    next.sources.enabled = overrides.sources_enabled;
  }
  if (typeof overrides.since_days === "number") {
    next.sources.ted.days_back = overrides.since_days;
  }
  if (typeof overrides.limit === "number") {
    next.sources.ted.limit = overrides.limit;
  }
  if (typeof overrides.min_score === "number") {
    next.matching.min_match_score = overrides.min_score;
  }
  if (typeof overrides.radius_km === "number") {
    next.matching.radius_km = overrides.radius_km;
  }
  if (overrides.language) {
    next.company.language = overrides.language;
  }
  if (overrides.tone) {
    next.company.tone = overrides.tone;
  }

  return configSchema.parse(next) as Config;
}
