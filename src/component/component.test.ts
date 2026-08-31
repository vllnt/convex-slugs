import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const scope = "global";
const bounds = { minLength: 1, maxLength: 256 };

function setup() {
  return convexTest(schema, modules);
}

async function reserve(
  t: ReturnType<typeof setup>,
  slug: string,
  resourceRef: string,
) {
  return await t.mutation(api.mutations.reserve, {
    scope,
    slug,
    resourceRef,
    bounds,
  });
}

async function rename(
  t: ReturnType<typeof setup>,
  fromSlug: string,
  toSlug: string,
) {
  return await t.mutation(api.mutations.rename, {
    scope,
    fromSlug,
    toSlug,
    bounds,
  });
}

describe("slugs component — internal repair and inspection APIs", () => {
  test("counts collapsed redirect chains", async () => {
    const t = setup();
    await reserve(t, "a", "doc");
    await rename(t, "a", "b");
    await rename(t, "b", "c");
    expect(await t.query(internal.queries.countRedirects, { scope })).toBe(2);
  });

  test("rename patches a pre-existing redirect row in place", async () => {
    const t = setup();
    await reserve(t, "src", "r");
    await t.mutation(internal.mutations.insertRedirectRaw, {
      scope,
      fromSlug: "src",
      toSlug: "stale",
    });
    expect(await rename(t, "src", "dst")).toEqual({ ok: true });
    expect(
      await t.query(api.queries.redirectFor, { scope, slug: "src" }),
    ).toBe("dst");
    expect(await t.query(internal.queries.countRedirects, { scope })).toBe(1);
  });

  test("duplicate slug rows degrade instead of throwing", async () => {
    const t = setup();
    await reserve(t, "twin", "first");
    await t.mutation(internal.mutations.insertRaw, {
      scope,
      slug: "twin",
      resourceRef: "first-dup",
    });
    expect(await t.query(api.queries.resolve, { scope, slug: "twin" })).toBe(
      "first",
    );
    expect(
      await t.query(api.queries.slugForResource, {
        scope,
        resourceRef: "first",
      }),
    ).toBe("twin");
    expect(await rename(t, "twin", "twin3")).toEqual({ ok: true });
    expect(
      await t.mutation(api.mutations.release, { scope, slug: "twin" }),
    ).toBeNull();
  });

  test("repoints and then clears multiple inbound redirects", async () => {
    const t = setup();
    await reserve(t, "mb", "r1");
    await t.mutation(internal.mutations.insertRedirectRaw, {
      scope,
      fromSlug: "ma",
      toSlug: "mb",
    });
    await t.mutation(internal.mutations.insertRedirectRaw, {
      scope,
      fromSlug: "mx",
      toSlug: "mb",
    });
    await rename(t, "mb", "mc");
    expect(await t.query(api.queries.redirectFor, { scope, slug: "ma" })).toBe(
      "mc",
    );
    expect(await t.query(api.queries.redirectFor, { scope, slug: "mx" })).toBe(
      "mc",
    );
    await t.mutation(api.mutations.release, { scope, slug: "mc" });
    expect(
      await t.query(api.queries.redirectFor, { scope, slug: "ma" }),
    ).toBeNull();
    expect(
      await t.query(api.queries.redirectFor, { scope, slug: "mx" }),
    ).toBeNull();
  });
});
