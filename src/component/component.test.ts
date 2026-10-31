import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

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

describe("slugs component — redirect and history integrity", () => {
  test("renaming back to a previous name leaves no redirect from a live slug", async () => {
    const t = setup();
    await reserve(t, "a", "doc");
    await rename(t, "a", "b");
    expect(await rename(t, "b", "a")).toEqual({ ok: true });
    expect(await t.query(api.queries.redirectFor, { scope, slug: "a" })).toBe(
      null,
    );
    expect(await t.query(api.queries.redirectFor, { scope, slug: "b" })).toBe(
      "a",
    );
    expect(await t.query(internal.queries.countRedirects, { scope })).toBe(1);
  });

  test("a longer rename cycle never yields a redirect that loops", async () => {
    const t = setup();
    await reserve(t, "a", "doc");
    for (const [from, to] of [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["a", "b"],
    ] as const) {
      expect(await rename(t, from, to)).toEqual({ ok: true });
    }
    expect(await t.query(api.queries.resolve, { scope, slug: "b" })).toBe(
      "doc",
    );
    for (const old of ["a", "c"]) {
      expect(
        await t.query(api.queries.redirectFor, { scope, slug: old }),
      ).toBe("b");
    }
    expect(await t.query(api.queries.redirectFor, { scope, slug: "b" })).toBe(
      null,
    );
  });
});

describe("slugs component — concurrent claims", () => {
  test("simultaneous reserves of one slug let exactly one win", async () => {
    const t = setup();
    const results = await Promise.all(
      ["r1", "r2", "r3", "r4"].map((ref) => reserve(t, "race", ref)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.reason === "SLUG_TAKEN")).toHaveLength(3);
  });

  test("simultaneous renames onto one target let exactly one win", async () => {
    const t = setup();
    await reserve(t, "x", "rx");
    await reserve(t, "y", "ry");
    const results = await Promise.all([rename(t, "x", "z"), rename(t, "y", "z")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.reason === "SLUG_TAKEN")).toHaveLength(1);
  });
});

describe("slugs component — argument validation", () => {
  const invalid = { data: { code: "INVALID_ARGUMENT" } };

  test("empty scope or resourceRef is rejected", async () => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.reserve, {
        scope: "",
        slug: "s",
        resourceRef: "r",
        bounds,
      }),
    ).rejects.toMatchObject(invalid);
    await expect(reserve(t, "s", "")).rejects.toMatchObject(invalid);
    await expect(
      t.mutation(api.mutations.release, { scope: "", slug: "s" }),
    ).rejects.toMatchObject(invalid);
    await expect(
      t.mutation(api.mutations.rename, {
        scope: "",
        fromSlug: "a",
        toSlug: "b",
        bounds,
      }),
    ).rejects.toMatchObject(invalid);
  });

  test("non-finite or inverted bounds are rejected", async () => {
    const t = setup();
    for (const b of [
      { minLength: 1, maxLength: Number.NaN },
      { minLength: Number.NaN, maxLength: 5 },
      { minLength: 1, maxLength: Number.POSITIVE_INFINITY },
      { minLength: 3, maxLength: 2 },
      { minLength: 1, maxLength: 2.5 },
    ]) {
      await expect(
        t.mutation(api.mutations.reserve, {
          scope,
          slug: "s",
          resourceRef: "r",
          bounds: b,
        }),
      ).rejects.toMatchObject(invalid);
    }
    await expect(
      t.mutation(api.mutations.rename, {
        scope,
        fromSlug: "a",
        toSlug: "b",
        bounds: { minLength: 1, maxLength: Number.NaN },
      }),
    ).rejects.toMatchObject(invalid);
  });
});
