import { describe, expect, it } from "bun:test";
import { parseArgs } from "../src/interfaces/cli";

describe("parseArgs", () => {
  it("parses valid numeric overrides", () => {
    const args = parseArgs(["run", "--since", "14d", "--limit", "300", "--min-score", "0.6", "--radius-km", "150"]);

    expect(args.sinceDays).toBe(14);
    expect(args.limit).toBe(300);
    expect(args.minScore).toBe(0.6);
    expect(args.radiusKm).toBe(150);
  });

  it("rejects non-numeric values", () => {
    expect(() => parseArgs(["run", "--limit", "abc"])).toThrow("Invalid numeric value for --limit");
    expect(() => parseArgs(["run", "--min-score", "2"])).toThrow("--min-score must be between 0 and 1");
    expect(() => parseArgs(["run", "--radius-km", "-1"])).toThrow("--radius-km must be non-negative");
  });

  it("rejects unknown options", () => {
    expect(() => parseArgs(["run", "--unknown-flag"])).toThrow("Unknown option");
  });
});
