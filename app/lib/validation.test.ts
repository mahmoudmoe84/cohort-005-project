import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseFormData, parseJsonBody } from "./validation";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(5, "Title is too long"),
  price: z.coerce.number().int("Price must be whole"),
});

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("parseFormData", () => {
  it("returns the parsed data when the form is valid", () => {
    expect(parseFormData(form({ title: "Hi", price: "3" }), schema)).toEqual({
      success: true,
      data: { title: "Hi", price: 3 },
    });
  });

  it("returns one message per failing field", () => {
    expect(parseFormData(form({ title: "", price: "1.5" }), schema)).toEqual({
      success: false,
      errors: { title: "Title is required", price: "Price must be whole" },
    });
  });

  it("keeps the first message when a field fails more than one check", () => {
    const twoChecks = z.object({
      code: z.string().length(4, "Use 4 characters").regex(/^\d+$/, "Digits only"),
    });

    expect(parseFormData(form({ code: "ab" }), twoChecks)).toEqual({
      success: false,
      errors: { code: "Use 4 characters" },
    });
  });
});

describe("parseJsonBody", () => {
  it("maps a JSON body's errors the same way", async () => {
    const request = new Request("http://test/", {
      method: "POST",
      body: JSON.stringify({ title: "Too long", price: 2 }),
    });

    expect(await parseJsonBody(request, schema)).toEqual({
      success: false,
      errors: { title: "Title is too long" },
    });
  });
});
