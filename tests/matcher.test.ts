import { describe, expect, it } from "bun:test";
import { normalizeMatchResult } from "../src/core/matcher";

describe("normalizeMatchResult", () => {
  it("converts percentage scores to 0..1 range", () => {
    const out = normalizeMatchResult({
      match_score: 82,
      selected_service_types: ["Electrical Works"],
      reasons: "Strong fit"
    });

    expect(out.match_score).toBe(0.82);
  });

  it("handles string score and service string", () => {
    const out = normalizeMatchResult({
      match_score: "67%",
      selected_service_types: "HVAC Installation, Electrical Works",
      reasons: ["Matches HVAC", "Has electrical scope"]
    });

    expect(out.match_score).toBe(0.67);
    expect(out.selected_service_types).toEqual(["HVAC Installation", "Electrical Works"]);
    expect(out.reasons).toContain("Matches HVAC");
  });

  it("clamps invalid scores", () => {
    const high = normalizeMatchResult({ match_score: 999 });
    const low = normalizeMatchResult({ match_score: -5 });

    expect(high.match_score).toBe(1);
    expect(low.match_score).toBe(0);
  });
});
