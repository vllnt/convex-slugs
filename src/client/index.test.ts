import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import { Slugs } from "./index.js";
import type { SlugsComponent } from "./index.js";

const component = {
  mutations: { reserve: "reserve", release: "release", rename: "rename" },
  queries: {},
} as unknown as SlugsComponent;

function ctx() {
  return { runMutation: vi.fn().mockResolvedValue({ ok: true }) };
}

describe("Slugs client options", () => {
  test("reserved words are matched after the same normalization as slugs", async () => {
    const c = ctx();
    const slugs = new Slugs(component, { reservedWords: ["Admin", " Root "] });
    expect(await slugs.reserve(c, "ADMIN", "r")).toEqual({
      ok: false,
      reason: "SLUG_RESERVED",
    });
    expect(await slugs.rename(c, "a", "root")).toEqual({
      ok: false,
      reason: "SLUG_RESERVED",
    });
    expect(c.runMutation).not.toHaveBeenCalled();
  });

  test("a global or sticky pattern gives the same answer on every call", async () => {
    const c = ctx();
    const slugs = new Slugs(component, { pattern: /^[a-z]+$/g });
    for (let i = 0; i < 3; i++) {
      expect(await slugs.reserve(c, "abc", "r")).toEqual({ ok: true });
    }
  });

  test.each([
    { minLength: Number.NaN },
    { maxLength: Number.NaN },
    { maxLength: Number.POSITIVE_INFINITY },
    { minLength: -1 },
    { minLength: 0.5 },
    { maxLength: 0 },
    { minLength: 5, maxLength: 4 },
    { defaultScope: "" },
  ])("invalid options %j are rejected at construction", (options) => {
    let thrown: unknown;
    try {
      new Slugs(component, options);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConvexError);
    expect((thrown as ConvexError<{ code: string }>).data.code).toBe(
      "INVALID_OPTIONS",
    );
  });
});
