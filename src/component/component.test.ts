import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { Slugs } from "../client/index.js";
import type { SlugsComponent } from "../client/index.js";

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

  test("a 0.1.0 row under scope '' can be read but not released or renamed", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("slugs", { scope: "", slug: "old", resourceRef: "r" });
    });
    expect(await t.query(api.queries.resolve, { scope: "", slug: "old" })).toBe(
      "r",
    );
    expect(
      await t.query(api.queries.slugForResource, { scope: "", resourceRef: "r" }),
    ).toBe("old");
    expect(
      await t.query(api.queries.redirectFor, { scope: "", slug: "old" }),
    ).toBeNull();
    await expect(
      t.mutation(api.mutations.release, { scope: "", slug: "old" }),
    ).rejects.toMatchObject(invalid);
    await expect(
      t.mutation(api.mutations.rename, {
        scope: "",
        fromSlug: "old",
        toSlug: "new",
        bounds,
      }),
    ).rejects.toMatchObject(invalid);
    expect(await t.query(api.queries.resolve, { scope: "", slug: "old" })).toBe(
      "r",
    );
  });
});

describe("slugs component — 1024 UTF-16 code unit cap on writes", () => {
  const invalid = { data: { code: "INVALID_ARGUMENT" } };
  // Bounds wider than the cap: the cap holds whatever the caller passes.
  const wide = { minLength: 1, maxLength: 1_000_000 };
  const at = "s".repeat(1024);
  const over = "s".repeat(1025);

  function write(
    t: ReturnType<typeof setup>,
    args: { scope?: string; slug?: string; resourceRef?: string },
  ) {
    return t.mutation(api.mutations.reserve, {
      scope: args.scope ?? scope,
      slug: args.slug ?? "s",
      resourceRef: args.resourceRef ?? "r",
      bounds: wide,
    });
  }

  function move(
    t: ReturnType<typeof setup>,
    args: { scope?: string; fromSlug: string; toSlug: string },
  ) {
    return t.mutation(api.mutations.rename, {
      scope: args.scope ?? scope,
      fromSlug: args.fromSlug,
      toSlug: args.toSlug,
      bounds: wide,
    });
  }

  test("reserve: a 1024-unit slug passes, 1025 is SLUG_INVALID", async () => {
    const t = setup();
    expect(await write(t, { slug: over })).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await write(t, { slug: at })).toEqual({ ok: true });
    expect(await t.query(api.queries.resolve, { scope, slug: at })).toBe("r");
  });

  test("rename: a 1024-unit toSlug passes, 1025 is SLUG_INVALID", async () => {
    const t = setup();
    await write(t, { slug: "a" });
    expect(await move(t, { fromSlug: "a", toSlug: over })).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await t.query(api.queries.resolve, { scope, slug: "a" })).toBe("r");
    expect(await move(t, { fromSlug: "a", toSlug: at })).toEqual({ ok: true });
    expect(await t.query(api.queries.redirectFor, { scope, slug: "a" })).toBe(
      at,
    );
  });

  test("reserve and rename: a 1024-unit scope passes, 1025 throws INVALID_ARGUMENT", async () => {
    const t = setup();
    const atScope = "x".repeat(1024);
    const overScope = "x".repeat(1025);
    await expect(write(t, { scope: overScope })).rejects.toMatchObject(invalid);
    await expect(
      move(t, { scope: overScope, fromSlug: "a", toSlug: "b" }),
    ).rejects.toMatchObject(invalid);
    expect(await write(t, { scope: atScope, slug: "a" })).toEqual({ ok: true });
    expect(
      await move(t, { scope: atScope, fromSlug: "a", toSlug: "b" }),
    ).toEqual({ ok: true });
    expect(
      await t.query(api.queries.resolve, { scope: atScope, slug: "b" }),
    ).toBe("r");
  });

  test("reserve: a 1024-unit resourceRef passes, 1025 throws INVALID_ARGUMENT", async () => {
    const t = setup();
    await expect(
      write(t, { resourceRef: "r".repeat(1025) }),
    ).rejects.toMatchObject(invalid);
    expect(await write(t, { resourceRef: "r".repeat(1024) })).toEqual({
      ok: true,
    });
    expect(
      await t.query(api.queries.slugForResource, {
        scope,
        resourceRef: "r".repeat(1024),
      }),
    ).toBe("s");
  });

  test("the cap counts UTF-16 code units, not code points or UTF-8 bytes", async () => {
    const t = setup();
    // 😀 is 1 code point, 2 UTF-16 code units and 4 UTF-8 bytes.
    const emoji512 = "😀".repeat(512);
    const emoji513 = "😀".repeat(513);
    expect(emoji512.length).toBe(1024);
    expect([...emoji513]).toHaveLength(513); // well under 1024 code points
    expect(new TextEncoder().encode(emoji512)).toHaveLength(2048); // over 1024 bytes
    expect(await write(t, { slug: emoji513 })).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await write(t, { slug: emoji512 })).toEqual({ ok: true });
    // The boundary falls inside a surrogate pair: 1023 + 2 = 1025 units.
    expect(await write(t, { slug: `${"a".repeat(1023)}😀` })).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await write(t, { slug: `${"a".repeat(1022)}😀` })).toEqual({
      ok: true,
    });
    await expect(
      write(t, { slug: "e", resourceRef: emoji513 }),
    ).rejects.toMatchObject(invalid);
    expect(await write(t, { slug: "e", resourceRef: emoji512 })).toEqual({
      ok: true,
    });
  });

  test("the client accepts maxLength over 1024; the component still caps the slug", async () => {
    const t = setup();
    const component = api as unknown as SlugsComponent;
    const runner = {
      runMutation: (ref: never, args: never) => t.mutation(ref, args),
    };
    const slugs = new Slugs(component, { maxLength: 2048 });
    expect(await slugs.reserve(runner, over, "r")).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(await slugs.reserve(runner, at, "r")).toEqual({ ok: true });
  });
});

describe("slugs component — rows stored over the cap by an older version", () => {
  const invalid = { data: { code: "INVALID_ARGUMENT" } };
  const longSlug = "l".repeat(1025);
  const longScope = "x".repeat(1025);
  const longRef = "r".repeat(1025);

  async function seed(t: ReturnType<typeof setup>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("slugs", { scope, slug: longSlug, resourceRef: "a" });
      await ctx.db.insert("slugs", { scope, slug: "b", resourceRef: longRef });
      await ctx.db.insert("slugs", {
        scope: longScope,
        slug: "c",
        resourceRef: "c",
      });
      await ctx.db.insert("redirects", {
        scope,
        fromSlug: "old",
        toSlug: longSlug,
      });
    });
  }

  test("resolve, redirectFor and slugForResource still return them", async () => {
    const t = setup();
    await seed(t);
    expect(await t.query(api.queries.resolve, { scope, slug: longSlug })).toBe(
      "a",
    );
    expect(
      await t.query(api.queries.slugForResource, { scope, resourceRef: "a" }),
    ).toBe(longSlug);
    expect(
      await t.query(api.queries.slugForResource, {
        scope,
        resourceRef: longRef,
      }),
    ).toBe("b");
    expect(await t.query(api.queries.resolve, { scope, slug: "b" })).toBe(
      longRef,
    );
    expect(
      await t.query(api.queries.resolve, { scope: longScope, slug: "c" }),
    ).toBe("c");
    expect(await t.query(api.queries.redirectFor, { scope, slug: "old" })).toBe(
      longSlug,
    );
  });

  test("release removes them and the redirects that point at them", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(api.mutations.release, { scope, slug: longSlug });
    await t.mutation(api.mutations.release, { scope, slug: "b" });
    await t.mutation(api.mutations.release, { scope: longScope, slug: "c" });
    expect(
      await t.query(api.queries.resolve, { scope, slug: longSlug }),
    ).toBeNull();
    expect(
      await t.query(api.queries.redirectFor, { scope, slug: "old" }),
    ).toBeNull();
    expect(
      await t.query(api.queries.slugForResource, {
        scope,
        resourceRef: longRef,
      }),
    ).toBeNull();
    expect(
      await t.query(api.queries.resolve, { scope: longScope, slug: "c" }),
    ).toBeNull();
  });

  test("rename from an over-cap slug to a short one works and repoints its redirects", async () => {
    const t = setup();
    await seed(t);
    expect(await rename(t, longSlug, "short")).toEqual({ ok: true });
    expect(await t.query(api.queries.resolve, { scope, slug: "short" })).toBe(
      "a",
    );
    expect(
      await t.query(api.queries.redirectFor, { scope, slug: longSlug }),
    ).toBe("short");
    expect(await t.query(api.queries.redirectFor, { scope, slug: "old" })).toBe(
      "short",
    );
  });

  test("a row with an over-cap resourceRef can be renamed and keeps its ref", async () => {
    const t = setup();
    await seed(t);
    expect(await rename(t, "b", "b2")).toEqual({ ok: true });
    expect(
      await t.query(api.queries.slugForResource, {
        scope,
        resourceRef: longRef,
      }),
    ).toBe("b2");
  });

  test("reserving or renaming onto an over-cap slug is SLUG_INVALID and leaves the row", async () => {
    const t = setup();
    await seed(t);
    const wide = { minLength: 1, maxLength: 1_000_000 };
    expect(
      await t.mutation(api.mutations.reserve, {
        scope,
        slug: longSlug,
        resourceRef: "z",
        bounds: wide,
      }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
    expect(
      await t.mutation(api.mutations.rename, {
        scope,
        fromSlug: "b",
        toSlug: longSlug,
        bounds: wide,
      }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
    expect(await t.query(api.queries.resolve, { scope, slug: longSlug })).toBe(
      "a",
    );
    expect(await t.query(api.queries.resolve, { scope, slug: "b" })).toBe(
      longRef,
    );
  });

  test("reserve and rename in an over-cap scope throw INVALID_ARGUMENT", async () => {
    const t = setup();
    await seed(t);
    await expect(
      t.mutation(api.mutations.reserve, {
        scope: longScope,
        slug: "d",
        resourceRef: "d",
        bounds,
      }),
    ).rejects.toMatchObject(invalid);
    await expect(
      t.mutation(api.mutations.rename, {
        scope: longScope,
        fromSlug: "c",
        toSlug: "c2",
        bounds,
      }),
    ).rejects.toMatchObject(invalid);
    expect(
      await t.query(api.queries.resolve, { scope: longScope, slug: "c" }),
    ).toBe("c");
  });
});
