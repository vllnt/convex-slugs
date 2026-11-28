import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import type { ComponentApi } from "../component/_generated/component.js";
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

  test("length bounds are checked on the client before any mutation call", async () => {
    const c = ctx();
    const slugs = new Slugs(component, { minLength: 3, maxLength: 4 });
    expect(await slugs.reserve(c, "abcde", "r")).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await slugs.rename(c, "abc", "ab")).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(c.runMutation).not.toHaveBeenCalled();
    expect(await slugs.reserve(c, "abcd", "r")).toEqual({ ok: true });
    expect(await slugs.reserve(c, "abc", "r")).toEqual({ ok: true });
    expect(c.runMutation).toHaveBeenCalledTimes(2);
  });

  test("an empty slug is SLUG_INVALID even with minLength 0", async () => {
    const c = ctx();
    const slugs = new Slugs(component, { minLength: 0 });
    expect(await slugs.reserve(c, " ", "r")).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await slugs.rename(c, "a", "")).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(c.runMutation).not.toHaveBeenCalled();
  });

  test("pattern runs against the normalized slug", async () => {
    const c = ctx();
    const slugs = new Slugs(component, { pattern: /^[a-z]+$/ });
    expect(await slugs.reserve(c, " ADA ", "r")).toEqual({ ok: true });
    expect(c.runMutation).toHaveBeenCalledWith("reserve", {
      scope: "global",
      slug: "ada",
      resourceRef: "r",
      bounds: { minLength: 1, maxLength: 256 },
    });
    const caseKept = new Slugs(component, {
      foldCase: false,
      pattern: /^[a-z]+$/,
    });
    expect(await caseKept.reserve(c, "ADA", "r")).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
  });

  test("toLowerCase is not full Unicode case folding: STRASSE and straße differ", async () => {
    const c = ctx();
    const slugs = new Slugs(component);
    await slugs.reserve(c, "STRASSE", "r");
    await slugs.reserve(c, "straße", "r");
    const sent = c.runMutation.mock.calls.map(
      (call) => (call[1] as { slug: string }).slug,
    );
    expect(sent).toEqual(["strasse", "straße"]);
  });

  test("the generated ComponentApi and SlugsComponent are the same shape", () => {
    const api = component as unknown as ComponentApi;
    const asClient: SlugsComponent = api;
    const asGenerated: ComponentApi = asClient;
    expect(asGenerated).toBe(component);
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
