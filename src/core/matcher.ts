import { z } from "zod";
import { callOpenAIJson } from "./openai";
import type { MatchResult } from "./types";

const serviceTypes = [
  "Construction Services",
  "Road Construction",
  "Building Renovation",
  "Fit Out Services",
  "Electrical Works",
  "Plumbing Works",
  "HVAC Installation",
  "Landscaping",
  "Consulting Services",
  "Engineering Services",
  "Architectural Services",
  "Project Management",
  "Maintenance Services",
  "Facility Management",
  "Software Development",
  "IT Support Services",
  "Cybersecurity Services",
  "Energy Services",
  "Environmental Services"
];

const matchSchema = z.object({
  match_score: z.number().min(0).max(1),
  selected_service_types: z.array(z.string()),
  reasons: z.string(),
  english_summary: z.string().default("")
});

const prompt =
  "You are a procurement lead matcher. Return strict JSON with match_score (0..1 decimal), selected_service_types, reasons, english_summary. "
  + "Keep reasons concise (<= 12 words) and focused on the main fit/mismatch. "
  + "Only emit JSON.";

function normalizeScore(value: unknown): number {
  let score = 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    score = value;
  } else if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").trim());
    if (Number.isFinite(parsed)) {
      score = parsed;
    }
  }

  // Some models return percentage-like values (e.g. 82 instead of 0.82).
  if (score > 1 && score <= 100) {
    score /= 100;
  }

  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

function normalizeServiceTypes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join("; ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

export function normalizeMatchResult(raw: unknown): MatchResult {
  const candidate =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  return matchSchema.parse({
    match_score: normalizeScore(candidate.match_score),
    selected_service_types: normalizeServiceTypes(candidate.selected_service_types),
    reasons: normalizeText(candidate.reasons),
    english_summary: normalizeText(candidate.english_summary)
  });
}

export async function matchLead(companyServices: string, leadText: string): Promise<MatchResult> {
  if (!process.env.OPENAI_API_KEY || !leadText.trim()) {
    return {
      match_score: 0,
      selected_service_types: [],
      reasons: !process.env.OPENAI_API_KEY ? "OPENAI_API_KEY missing" : "Empty lead text",
      english_summary: ""
    };
  }

  try {
    const model = process.env.LEADAGENT_MATCH_MODEL ?? "gpt-5-nano";
    const raw = await callOpenAIJson<unknown>(
      [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify({
            services_catalog: serviceTypes,
            company_services: companyServices,
            lead_text: leadText.slice(0, 5000)
          })
        }
      ],
      { temperature: 0.2, model }
    );

    return normalizeMatchResult(raw);
  } catch (error) {
    return {
      match_score: 0,
      selected_service_types: [],
      reasons: `Matching error: ${error instanceof Error ? error.message : String(error)}`,
      english_summary: ""
    };
  }
}
