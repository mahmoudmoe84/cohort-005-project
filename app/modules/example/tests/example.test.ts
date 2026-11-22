import { describe, expect, it } from "vitest";
import { readingMinutes } from "../index";

describe("readingMinutes", () => {
  it("rounds a short text up to one minute", () => {
    expect(readingMinutes("just a few words")).toBe(1);
  });

  it("counts 200 words per minute", () => {
    expect(readingMinutes("word ".repeat(401))).toBe(3);
  });
});
