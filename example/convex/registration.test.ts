import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import { api, components } from "./_generated/api";
import { register } from "../../src/test";

/** A host app schema that shares nothing with the component's schema. */
const hostSchema = defineSchema({
  unrelated: defineTable({ label: v.string() }),
});
const modules = import.meta.glob("./**/*.ts");

test("registration accepts unrelated host schemas and named mounts", async () => {
  const t = convexTest(hostSchema, modules);
  const registration = vi.spyOn(t, "registerComponent");
  expect(() => {
    register(t);
  }).not.toThrow();
  expect(() => {
    register(t, "custom");
  }).not.toThrow();
  expect(registration.mock.calls.map((call) => call[0])).toEqual([
    "slugs",
    "custom",
  ]);
  const registeredModules = registration.mock.calls[1]?.[2];
  if (!registeredModules) throw new Error("missing registered modules");
  /** Test files match the glob in this repo only; the package ships none. */
  const functionModules = Object.entries(registeredModules).filter(
    ([path]) => !path.endsWith(".test.ts"),
  );
  expect(functionModules.map(([path]) => path)).toEqual(
    expect.arrayContaining([
      "./component/mutations.ts",
      "./component/queries.ts",
      "./component/schema.ts",
    ]),
  );
  await Promise.all(functionModules.map(async ([, load]) => load()));
});

test("the mounted component serves calls next to host tables", async () => {
  const t = convexTest(hostSchema, modules);
  register(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("unrelated", { label: "host row" });
  });
  expect(
    await t.mutation(api.example.reserve, { slug: "Ada", resourceRef: "u1" }),
  ).toEqual({ ok: true });
  const args = { scope: "global", slug: "ada" };
  expect(await t.query(components.slugs.queries.resolve, args)).toBe("u1");
  expect(
    await t.mutation(components.slugs.mutations.reserve, {
      ...args,
      resourceRef: "u2",
      bounds: { minLength: 1, maxLength: 64 },
    }),
  ).toEqual({ ok: false, reason: "SLUG_TAKEN" });
  const labels = await t.run(async (ctx) =>
    (await ctx.db.query("unrelated").collect()).map((row) => row.label),
  );
  expect(labels).toEqual(["host row"]);
});
