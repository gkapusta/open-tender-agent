import { describe, expect, test } from "bun:test";
import { normalizeText } from "../src/core/util";

describe("normalizeText", () => {
  test("collapses whitespace", () => {
    expect(normalizeText("hello   world\n\nagain")).toBe("hello world again");
  });

  test("handles empty", () => {
    expect(normalizeText("")).toBe("");
  });
});
