import { withRetry } from "../retry";
import { normalizeText, UA_DEFAULT } from "../util";
import { fetchWithTimeout } from "../http";
import type { Config, Lead } from "../types";

const TED_API_URL = "https://api.ted.europa.eu/v3/notices/search";
const TED_TIMEOUT_MS = 45_000;
const ISO3_COUNTRY = /^[A-Z]{3}$/;

const fields = [
  "ND",
  "PD",
  "FT",
  "TV",
  "TV_CUR",
  "notice-type",
  "organisation-email-tenderer",
  "organisation-name-tenderer",
  "organisation-country-tenderer",
  "organisation-internet-address-tenderer",
  "organisation-tel-tenderer",
  "organisation-city-tenderer",
  "buyer-country",
  "buyer-name"
];

function flatten(field: unknown): string[] {
  if (!field) return [];
  if (typeof field === "string" || typeof field === "number") {
    return [String(field)];
  }
  if (Array.isArray(field)) {
    return field.flatMap((item) => flatten(item));
  }
  if (typeof field === "object") {
    return Object.values(field as Record<string, unknown>).flatMap((item) => flatten(item));
  }
  return [];
}

function normalizeCountryFilter(codes: string[]): string[] {
  const out = new Set<string>();

  for (const code of codes) {
    const normalized = code.trim().toUpperCase();
    if (ISO3_COUNTRY.test(normalized)) {
      out.add(normalized);
    }
  }

  return [...out];
}

function buildWinners(notice: Record<string, unknown>): Array<{ name?: string; email?: string; phone?: string; city?: string }> {
  const names = flatten(notice["organisation-name-tenderer"]);
  const emails = Array.isArray(notice["organisation-email-tenderer"]) ? notice["organisation-email-tenderer"] : [];
  const phones = Array.isArray(notice["organisation-tel-tenderer"]) ? notice["organisation-tel-tenderer"] : [];
  const cities = Array.isArray(notice["organisation-city-tenderer"]) ? notice["organisation-city-tenderer"] : [];

  return names.map((name, idx) => ({
    name,
    email: typeof emails[idx] === "string" ? emails[idx] : undefined,
    phone: typeof phones[idx] === "string" ? phones[idx] : undefined,
    city: typeof cities[idx] === "string" ? cities[idx] : undefined
  }));
}

async function fetchPage(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withRetry(async () => {
    const response = await fetchWithTimeout(
      TED_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": UA_DEFAULT,
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      },
      TED_TIMEOUT_MS
    );

    if (!response.ok) {
      throw new Error(`TED request failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as Record<string, unknown>;
  });
}

export async function fetchTed(config: Config): Promise<Lead[]> {
  const daysBack = config.sources.ted.days_back;
  const countryFilter = normalizeCountryFilter(config.sources.ted.country_filter);
  const limit = config.sources.ted.limit;

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");

  const countryPart = countryFilter.length ? ` AND winner-country=(${countryFilter.join(" ")})` : "";
  const query = `notice-type IN (can-standard can-social can-desg can-tran) AND PD > ${since}${countryPart}`;

  const leads: Lead[] = [];
  let page = 1;

  while (leads.length < limit) {
    const payload = {
      query,
      fields,
      scope: "ACTIVE",
      paginationMode: "PAGE_NUMBER",
      page,
      limit: Math.min(250, limit - leads.length),
      onlyLatestVersions: true,
      checkQuerySyntax: false
    };

    const result = await fetchPage(payload);
    const notices = Array.isArray(result.notices) ? result.notices : [];

    if (!notices.length) {
      break;
    }

    for (const notice of notices) {
      if (!notice || typeof notice !== "object") continue;
      const n = notice as Record<string, unknown>;
      const id = typeof n.ND === "string" ? n.ND : undefined;
      if (!id) continue;

      const winners = buildWinners(n);
      const text = normalizeText(flatten(n.FT).join("\n"), 15_000);
      const buyerCountry = Array.isArray(n["buyer-country"]) ? n["buyer-country"][0] : undefined;
      const currency = Array.isArray(n.TV_CUR) ? n.TV_CUR[0] : undefined;

      leads.push({
        source: "TED",
        external_id: id,
        summary_src: text.slice(0, 500),
        full_text: text,
        country: typeof buyerCountry === "string" ? buyerCountry : undefined,
        city: winners[0]?.city,
        budget_value: typeof n.TV === "number" ? n.TV : undefined,
        budget_currency: typeof currency === "string" ? currency : undefined,
        contact_name: winners[0]?.name,
        contact_email: winners[0]?.email,
        contact_phone: winners[0]?.phone,
        buyer_name: flatten(n["buyer-name"]).join(", "),
        published_date: typeof n.PD === "string" ? n.PD.split("+")[0] : undefined,
        raw: n
      });

      if (leads.length >= limit) {
        break;
      }
    }

    page += 1;
  }

  return leads;
}
