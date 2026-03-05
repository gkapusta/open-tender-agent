export type SourceName = "TED";

export interface CompanyConfig {
  name: string;
  website: string;
  address: string;
  language: string;
  tone: string;
  services: string;
}

export interface TedSourceConfig {
  days_back: number;
  country_filter: string[];
  limit: number;
}

export interface SourcesConfig {
  enabled: SourceName[];
  ted: TedSourceConfig;
}

export interface MatchingConfig {
  radius_km: number;
  require_contact: boolean;
  min_match_score: number;
}

export interface OutputConfig {
  csv_path: string;
  append: boolean;
  leads_email?: string;
}

export interface GeocodingConfig {
  provider: "nominatim";
  email: string;
  country_fallback: boolean;
}

export interface Config {
  company: CompanyConfig;
  sources: SourcesConfig;
  matching: MatchingConfig;
  output: OutputConfig;
  geocoding: GeocodingConfig;
}

export interface Lead {
  source: SourceName;
  external_id: string;
  title?: string;
  summary_src?: string;
  full_text?: string;
  country?: string;
  region?: string;
  city?: string;
  project_address?: string;
  budget_value?: number;
  budget_currency?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  buyer_name?: string;
  url?: string;
  published_date?: string;
  raw?: unknown;
}

export interface MatchResult {
  match_score: number;
  selected_service_types: string[];
  reasons: string;
  english_summary: string;
}

export interface EmailMessage {
  subject: string;
  body: string;
}

export interface ProcessedLead {
  source: SourceName;
  external_id: string;
  title?: string;
  summary?: string;
  country?: string;
  region?: string;
  city?: string;
  project_address?: string;
  budget_value?: number;
  budget_currency?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  company_match_score: number;
  location_ok: boolean;
  contact_ok: boolean;
  selected_service_types: string;
  outreach_channel: "email";
  message_subject: string;
  message_body: string;
  url?: string;
  published_date?: string;
  scraped_at: string;
}

export interface RunOverrides {
  sources_enabled?: SourceName[];
  since_days?: number;
  limit?: number;
  min_score?: number;
  radius_km?: number;
  language?: string;
  tone?: string;
}

export interface RunOptions {
  configPath: string;
  csvPath?: string;
  append?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  overrides?: RunOverrides;
}

export interface Stats {
  fetched_by_source: Record<string, number>;
  seen_skipped: number;
  dropped_low_score: number;
  dropped_no_contact: number;
  dropped_location: number;
  exported: number;
}

export interface RunResult {
  rows: ProcessedLead[];
  stats: Stats;
  outputCsvPath: string;
}
