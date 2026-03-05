import type { Config, Lead, ProcessedLead, RunOptions, RunResult, Stats } from "./types";
import { applyOverrides, loadConfig } from "./config";
import { createLogger, type Logger } from "./logger";
import { Storage } from "./storage";
import { Geocoder } from "./geocode";
import { fetchBySource } from "./sources";
import { matchLead } from "./matcher";
import { makeEmail } from "./message";
import { writeCsv } from "./csv";

function countryFromAddress(address: string): string | undefined {
  const chunks = address.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
  return chunks[chunks.length - 1];
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  BE: ["BELGIUM"],
  BEL: ["BELGIUM"],
  NL: ["NETHERLANDS"],
  NLD: ["NETHERLANDS"],
  DE: ["GERMANY"],
  DEU: ["GERMANY"],
  FR: ["FRANCE"],
  FRA: ["FRANCE"],
  ES: ["SPAIN"],
  ESP: ["SPAIN"],
  IT: ["ITALY"],
  ITA: ["ITALY"],
  PT: ["PORTUGAL"],
  PRT: ["PORTUGAL"],
  LU: ["LUXEMBOURG"],
  LUX: ["LUXEMBOURG"],
  GB: ["UNITEDKINGDOM", "UNITED KINGDOM"],
  GBR: ["UNITEDKINGDOM", "UNITED KINGDOM"],
  UK: ["UNITEDKINGDOM", "UNITED KINGDOM"],
  US: ["UNITEDSTATES", "UNITED STATES"],
  USA: ["UNITEDSTATES", "UNITED STATES"]
};

function countryVariants(value?: string | null): Set<string> {
  const variants = new Set<string>();
  if (!value) return variants;

  const upper = value.toUpperCase();
  const cleaned = upper.replace(/[^A-Z]/g, " ").trim();
  if (!cleaned) return variants;

  const joined = cleaned.replace(/\s+/g, "");
  if (joined) variants.add(joined);

  for (const token of cleaned.split(/\s+/)) {
    if (token) variants.add(token);
    const alias = COUNTRY_ALIASES[token];
    if (alias) {
      for (const entry of alias) {
        variants.add(entry.replace(/\s+/g, ""));
        variants.add(entry);
      }
    }
  }

  const alias = COUNTRY_ALIASES[joined];
  if (alias) {
    for (const entry of alias) {
      variants.add(entry.replace(/\s+/g, ""));
      variants.add(entry);
    }
  }

  return variants;
}

function countriesMatch(companyCountry?: string | null, leadCountry?: string | null): boolean {
  if (!companyCountry || !leadCountry) return false;
  const companyVariants = countryVariants(companyCountry);
  const leadVariants = countryVariants(leadCountry);
  const leadUpper = leadCountry.toUpperCase();
  const companyUpper = companyCountry.toUpperCase();

  for (const companyToken of companyVariants) {
    if (!companyToken) continue;
    for (const leadToken of leadVariants) {
      if (!leadToken) continue;
      if (companyToken === leadToken) return true;
    }
    if (leadUpper.includes(companyToken)) return true;
  }

  for (const leadToken of leadVariants) {
    if (leadToken && companyUpper.includes(leadToken)) return true;
  }

  return false;
}

export function countryMatchDebug(companyCountry?: string | null, leadCountry?: string | null): string {
  if (!companyCountry || !leadCountry) {
    return `company=${companyCountry ?? "none"} lead=${leadCountry ?? "none"}`;
  }
  const companyVariants = [...countryVariants(companyCountry)];
  const leadVariants = [...countryVariants(leadCountry)];
  return `company=${companyCountry} lead=${leadCountry} company_variants=[${companyVariants.join(", ")}] lead_variants=[${leadVariants.join(", ")}]`;
}

function oneLine(text: string, maxLen = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

export interface PipelineHooks {
  onStage?: (name: string) => void;
  onInfo?: (msg: string) => void;
}

function initStats(): Stats {
  return {
    fetched_by_source: {},
    seen_skipped: 0,
    dropped_low_score: 0,
    dropped_no_contact: 0,
    dropped_location: 0,
    exported: 0
  };
}

async function processLead(
  lead: Lead,
  config: Config,
  geocoder: Geocoder,
  hq: [number, number] | null,
  logger: Logger,
  stats: Stats
): Promise<ProcessedLead | null> {
  const match = await matchLead(config.company.services, lead.full_text ?? lead.summary_src ?? "");
  const score = Number(match.match_score.toFixed(3));
  const services = match.selected_service_types.length ? match.selected_service_types.join(", ") : "none";
  const matchReason = oneLine(match.reasons || "no reason");

  if (match.match_score < config.matching.min_match_score) {
    logger.debug(
      `Drop ${lead.source}:${lead.external_id} reason=low_score score=${score} threshold=${config.matching.min_match_score} services=[${services}] why="${matchReason}"`
    );
    stats.dropped_low_score += 1;
    return null;
  }

  let locationOk = false;
  let distanceKm: number | null = null;
  let locationReason = "unknown";
  const companyCountry = countryFromAddress(config.company.address);
  const leadCountry = lead.country;

  if (hq && lead.project_address) {
    const target = await geocoder.geocode(lead.project_address);
    if (target) {
      distanceKm = Geocoder.haversineKm(hq, target);
      locationOk = distanceKm <= config.matching.radius_km;
      locationReason = locationOk
        ? `distance_ok(${distanceKm.toFixed(1)}km<=${config.matching.radius_km}km)`
        : `distance_exceeds(${distanceKm.toFixed(1)}km>${config.matching.radius_km}km)`;
    } else {
      locationReason = "address_geocode_failed";
    }
  } else if (!hq) {
    locationReason = "company_geocode_unavailable";
  } else {
    locationReason = "lead_address_missing";
  }

  if (!locationOk && config.geocoding.country_fallback) {
    const fallbackOk = countriesMatch(companyCountry, leadCountry);
    if (fallbackOk) {
      locationOk = true;
      locationReason = `country_fallback(${leadCountry ?? "none"}~${companyCountry ?? "none"})`;
    } else {
      locationReason = `${locationReason}+country_fallback_miss(${leadCountry ?? "none"}!~${companyCountry ?? "none"})`;
      logger.debug(`Country fallback mismatch: ${countryMatchDebug(companyCountry, leadCountry)}`);
    }
  }

  if (!locationOk) {
    logger.debug(`Drop ${lead.source}:${lead.external_id} reason=location_mismatch details=${locationReason}`);
    stats.dropped_location += 1;
    return null;
  }

  const contactOk = Boolean(lead.contact_email || lead.contact_phone);
  if (config.matching.require_contact && !contactOk) {
    logger.debug(
      `Drop ${lead.source}:${lead.external_id} reason=missing_contact email=${lead.contact_email ? "yes" : "no"} phone=${lead.contact_phone ? "yes" : "no"}`
    );
    stats.dropped_no_contact += 1;
    return null;
  }

  const message = await makeEmail(
    {
      name: config.company.name,
      website: config.company.website,
      services: config.company.services,
      address: config.company.address
    },
    lead,
    config.company.language,
    config.company.tone
  );

  logger.debug(
    `Pass ${lead.source}:${lead.external_id} score=${score} services=[${services}] location=${locationReason}${
      distanceKm === null ? "" : ` distance_km=${distanceKm.toFixed(1)}`
    } contact=${contactOk ? "ok" : "not_required"}`
  );

  return {
    source: lead.source,
    external_id: lead.external_id,
    title: lead.title,
    summary: match.english_summary || lead.summary_src,
    country: lead.country,
    region: lead.region,
    city: lead.city,
    project_address: lead.project_address,
    budget_value: lead.budget_value,
    budget_currency: lead.budget_currency,
    contact_name: lead.contact_name,
    contact_email: lead.contact_email,
    contact_phone: lead.contact_phone,
    company_match_score: Number(match.match_score.toFixed(3)),
    location_ok: locationOk,
    contact_ok: contactOk,
    selected_service_types: match.selected_service_types.join("; "),
    outreach_channel: "email",
    message_subject: message.subject,
    message_body: message.body,
    url: lead.url,
    published_date: lead.published_date,
    scraped_at: new Date().toISOString()
  };
}

export async function runPipeline(options: RunOptions, hooks: PipelineHooks = {}): Promise<RunResult> {
  const logger = createLogger(options.verbose);
  hooks.onStage?.("load_config");

  let config = loadConfig(options.configPath);
  config = applyOverrides(config, options.overrides);
  hooks.onInfo?.(`Loaded config from ${options.configPath}`);
  hooks.onInfo?.(`Sources enabled: ${config.sources.enabled.join(", ")}`);

  const dryRun = options.dryRun ?? false;
  const append = options.append ?? config.output.append;
  const outputCsvPath = options.csvPath ?? config.output.csv_path;

  const storage = new Storage();
  const geocoder = new Geocoder(storage, config.geocoding.email, { callsPerSecond: 1, timeoutMs: 20_000 });

  hooks.onStage?.("geocode_company");
  const hq = await geocoder.geocode(config.company.address);
  logger.debug(`Company: ${config.company.name}`);
  hooks.onInfo?.(hq ? `Company geocoded: ${hq[0].toFixed(5)}, ${hq[1].toFixed(5)}` : "Company geocode unavailable");

  hooks.onStage?.("fetch_sources");
  const fetched = await fetchBySource(config, logger);
  const leads = Object.values(fetched).flat();

  const stats = initStats();
  for (const [source, rows] of Object.entries(fetched)) {
    stats.fetched_by_source[source] = rows.length;
    hooks.onInfo?.(`Fetched ${rows.length} leads from ${source}`);
  }

  hooks.onInfo?.(`Fetched ${leads.length} leads`);
  hooks.onStage?.("process");

  const rows: ProcessedLead[] = [];
  let processedCount = 0;

  for (const lead of leads) {
    processedCount += 1;

    if (storage.seen(lead.source, lead.external_id)) {
      logger.debug(`Skip ${lead.source}:${lead.external_id} already_seen`);
      stats.seen_skipped += 1;
      if (options.verbose && (processedCount === leads.length || processedCount % 10 === 0)) {
        hooks.onInfo?.(
          `Progress ${processedCount}/${leads.length} exported=${rows.length} seen=${stats.seen_skipped} dropped=${stats.dropped_low_score + stats.dropped_no_contact + stats.dropped_location}`
        );
      }
      continue;
    }

    const processed = await processLead(lead, config, geocoder, hq, logger, stats);
    if (!processed) {
      if (options.verbose && (processedCount === leads.length || processedCount % 10 === 0)) {
        hooks.onInfo?.(
          `Progress ${processedCount}/${leads.length} exported=${rows.length} seen=${stats.seen_skipped} dropped=${stats.dropped_low_score + stats.dropped_no_contact + stats.dropped_location}`
        );
      }
      continue;
    }

    rows.push(processed);
    if (!dryRun) {
      storage.markSeen(lead.source, lead.external_id);
    }

    if (options.verbose && (processedCount === leads.length || processedCount % 10 === 0)) {
      hooks.onInfo?.(
        `Progress ${processedCount}/${leads.length} exported=${rows.length} seen=${stats.seen_skipped} dropped=${stats.dropped_low_score + stats.dropped_no_contact + stats.dropped_location}`
      );
    }
  }

  stats.exported = rows.length;

  hooks.onStage?.("export");
  if (dryRun) {
    hooks.onInfo?.("Dry run enabled: skipping CSV write");
  } else if (!rows.length) {
    hooks.onInfo?.("No rows to export");
  } else {
    hooks.onInfo?.(`Writing ${rows.length} rows to ${outputCsvPath}`);
  }
  if (!dryRun && rows.length) {
    writeCsv(outputCsvPath, rows, append);
  }

  return {
    rows,
    stats,
    outputCsvPath
  };
}
