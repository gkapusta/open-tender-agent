import { afterEach, describe, expect, it } from "bun:test";
import type { Config } from "../src/core/types";
import { fetchTed } from "../src/core/sources/ted";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;

function makeConfig(limit = 3): Config {
  return {
    company: {
      name: "Test Company",
      website: "https://example.com",
      address: "Main Street 1, Brussels, Belgium",
      language: "en",
      tone: "professional",
      services: "Electrical works and HVAC installation"
    },
    sources: {
      enabled: ["TED"],
      ted: {
        days_back: 7,
        country_filter: ["BEL", "DEU"],
        limit
      }
    },
    matching: {
      radius_km: 100,
      require_contact: true,
      min_match_score: 0.55
    },
    output: {
      csv_path: "./out/leads.csv",
      append: true
    },
    geocoding: {
      provider: "nominatim",
      email: "ops@example.com",
      country_fallback: true
    }
  };
}

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
});

describe("fetchTed", () => {
  it("builds TED query using date window and country filter", async () => {
    Date.now = () => Date.parse("2026-02-18T12:00:00.000Z");
    const payloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(getUrl(input)).toBe("https://api.ted.europa.eu/v3/notices/search");
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

      return new Response(JSON.stringify({ notices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const leads = await fetchTed(makeConfig(3));

    expect(leads).toEqual([]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.query).toContain("PD > 20260211");
    expect(payloads[0]?.query).toContain("winner-country=(BEL DEU)");
    expect(payloads[0]?.page).toBe(1);
    expect(payloads[0]?.limit).toBe(3);
  });

  it("ignores invalid country filter values before building query", async () => {
    const config = makeConfig(3);
    config.sources.ted.country_filter = ["BEL", "deu", "1=1", "FRA)"] as unknown as string[];

    const payloads: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ notices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    await fetchTed(config);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.query).toContain("winner-country=(BEL DEU)");
    expect(String(payloads[0]?.query)).not.toContain("1=1");
  });

  it("maps notice data correctly and paginates until no notices", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const responses = [
      {
        notices: [
          {
            ND: "TED-001",
            PD: "2026-02-10+01:00",
            FT: ["  Line one ", ["Line", "two"]],
            TV: 1_500_000,
            TV_CUR: ["EUR"],
            "organisation-name-tenderer": [["ACME Build"]],
            "organisation-email-tenderer": ["bid@acme.test"],
            "organisation-tel-tenderer": ["+32 123"],
            "organisation-city-tenderer": ["Brussels"],
            "buyer-country": ["BEL"],
            "buyer-name": ["City of Brussels"]
          }
        ]
      },
      {
        notices: [
          {
            ND: "TED-002",
            PD: "2026-02-11+01:00",
            FT: "Second notice",
            "organisation-name-tenderer": ["Second Winner"],
            "buyer-country": ["DEU"],
            "buyer-name": ["Berlin Procurement"]
          }
        ]
      },
      { notices: [] }
    ];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const body = responses.shift() ?? { notices: [] };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const leads = await fetchTed(makeConfig(3));

    expect(payloads.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(leads).toHaveLength(2);

    expect(leads[0]).toMatchObject({
      source: "TED",
      external_id: "TED-001",
      country: "BEL",
      budget_value: 1_500_000,
      budget_currency: "EUR",
      contact_name: "ACME Build",
      contact_email: "bid@acme.test",
      contact_phone: "+32 123",
      city: "Brussels",
      buyer_name: "City of Brussels",
      published_date: "2026-02-10"
    });

    expect(leads[0]?.full_text).toBe("Line one Line two");
    expect(leads[0]?.summary_src).toBe("Line one Line two");
    expect(leads[1]).toMatchObject({
      external_id: "TED-002",
      country: "DEU",
      contact_name: "Second Winner"
    });
  });

  it("enforces the overall lead limit across pages", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          notices: [
            { ND: "TED-A", PD: "2026-02-01+01:00", FT: "A" },
            { ND: "TED-B", PD: "2026-02-01+01:00", FT: "B" },
            { ND: "TED-C", PD: "2026-02-01+01:00", FT: "C" }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }) as typeof fetch;

    const leads = await fetchTed(makeConfig(2));

    expect(leads.map((l) => l.external_id)).toEqual(["TED-A", "TED-B"]);
  });
});
