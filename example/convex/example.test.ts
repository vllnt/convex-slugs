import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}

describe("slugs — reserve / resolve", () => {
  test("reserve then resolve round-trips, case-folded (happy path)", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserve, {
      slug: "My-Handle",
      resourceRef: "user_1",
    });
    expect(r).toEqual({ ok: true });
    // default foldCase lowercases on store + lookup
    expect(await t.query(api.example.resolve, { slug: "MY-HANDLE" })).toBe("user_1");
    expect(await t.query(api.example.slugForResource, { resourceRef: "user_1" })).toBe(
      "my-handle",
    );
  });

  test("reserving a held slug is rejected", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "dup", resourceRef: "a" });
    const r = await t.mutation(api.example.reserve, { slug: "dup", resourceRef: "b" });
    expect(r).toEqual({ ok: false, reason: "SLUG_TAKEN" });
  });

  test("scopes are isolated", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, {
      slug: "home",
      resourceRef: "g1",
      scope: "siteA",
    });
    // same slug free in another scope
    const r = await t.mutation(api.example.reserve, {
      slug: "home",
      resourceRef: "g2",
      scope: "siteB",
    });
    expect(r).toEqual({ ok: true });
    expect(await t.query(api.example.resolve, { slug: "home", scope: "siteA" })).toBe("g1");
    expect(await t.query(api.example.resolve, { slug: "home", scope: "siteB" })).toBe("g2");
    // unknown scope misses
    expect(await t.query(api.example.resolve, { slug: "home", scope: "siteC" })).toBeNull();
  });

  test("resolve / slugForResource miss returns null", async () => {
    const t = setup();
    expect(await t.query(api.example.resolve, { slug: "ghost" })).toBeNull();
    expect(await t.query(api.example.slugForResource, { resourceRef: "ghost" })).toBeNull();
  });
});

describe("slugs — release", () => {
  test("release frees the slug; releasing an unheld slug is a no-op", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "temp", resourceRef: "x" });
    expect(await t.mutation(api.example.release, { slug: "temp" })).toBeNull();
    expect(await t.query(api.example.resolve, { slug: "temp" })).toBeNull();
    // idempotent — no throw when nothing to release
    expect(await t.mutation(api.example.release, { slug: "temp" })).toBeNull();
  });
});

describe("slugs — rename + redirect", () => {
  test("rename moves the slug and records a redirect (happy path)", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "old", resourceRef: "doc_1" });
    const r = await t.mutation(api.example.rename, { fromSlug: "old", toSlug: "new" });
    expect(r).toEqual({ ok: true });
    expect(await t.query(api.example.resolve, { slug: "new" })).toBe("doc_1");
    expect(await t.query(api.example.resolve, { slug: "old" })).toBeNull();
    expect(await t.query(api.example.redirectFor, { slug: "old" })).toBe("new");
    expect(await t.query(api.example.slugForResource, { resourceRef: "doc_1" })).toBe("new");
  });

  test("rename of a missing slug is rejected", async () => {
    const t = setup();
    const r = await t.mutation(api.example.rename, { fromSlug: "nope", toSlug: "x" });
    expect(r).toEqual({ ok: false, reason: "SLUG_NOT_FOUND" });
  });

  test("rename onto a held slug is rejected", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "a", resourceRef: "1" });
    await t.mutation(api.example.reserve, { slug: "b", resourceRef: "2" });
    const r = await t.mutation(api.example.rename, { fromSlug: "a", toSlug: "b" });
    expect(r).toEqual({ ok: false, reason: "SLUG_TAKEN" });
  });

  test("no redirect for a slug that was never renamed", async () => {
    const t = setup();
    expect(await t.query(api.example.redirectFor, { slug: "fresh" })).toBeNull();
  });
});

describe("slugs — client options (case-sensitive, custom scope)", () => {
  test("foldCase:false preserves case and is case-sensitive on lookup", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserveRaw, {
      slug: "CaseKept",
      resourceRef: "k1",
    });
    expect(r).toEqual({ ok: true });
    expect(await t.query(api.example.resolveRaw, { slug: "CaseKept" })).toBe("k1");
    // different case does not match under foldCase:false
    expect(await t.query(api.example.resolveRaw, { slug: "casekept" })).toBeNull();
  });
});

describe("slugs — redirect chains (hardening)", () => {
  test("chain A→B→C collapses: redirectFor(A) === C", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "a", resourceRef: "doc" });
    await t.mutation(api.example.rename, { fromSlug: "a", toSlug: "b" });
    await t.mutation(api.example.rename, { fromSlug: "b", toSlug: "c" });
    // A repointed through the chain to the live slug
    expect(await t.query(api.example.redirectFor, { slug: "a" })).toBe("c");
    expect(await t.query(api.example.redirectFor, { slug: "b" })).toBe("c");
    expect(await t.query(api.example.resolve, { slug: "c" })).toBe("doc");
    // exactly one redirect row per source (no unbounded growth): A→C and B→C
    expect(await t.query(api.example.countRedirects, {})).toBe(2);
  });

  test("renaming the same slug twice keeps one redirect row, latest target", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "p", resourceRef: "r" });
    await t.mutation(api.example.rename, { fromSlug: "p", toSlug: "q1" });
    // reserve p again then rename again so the from=p redirect upserts
    await t.mutation(api.example.reserve, { slug: "p", resourceRef: "r2" });
    await t.mutation(api.example.rename, { fromSlug: "p", toSlug: "q2" });
    expect(await t.query(api.example.redirectFor, { slug: "p" })).toBe("q2");
    // the from=p redirect was patched in place, not duplicated
    expect(await t.query(api.example.countRedirects, {})).toBe(1);
  });

  test("reserving a slug again clears its dangling redirect", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "alpha", resourceRef: "1" });
    await t.mutation(api.example.rename, { fromSlug: "alpha", toSlug: "beta" });
    expect(await t.query(api.example.redirectFor, { slug: "alpha" })).toBe("beta");
    // alpha becomes a live slug again — its redirect must be gone
    const r = await t.mutation(api.example.reserve, { slug: "alpha", resourceRef: "2" });
    expect(r).toEqual({ ok: true });
    expect(await t.query(api.example.redirectFor, { slug: "alpha" })).toBeNull();
    expect(await t.query(api.example.resolve, { slug: "alpha" })).toBe("2");
  });
});

describe("slugs — input validation (hardening)", () => {
  test("empty / whitespace slug is rejected SLUG_INVALID", async () => {
    const t = setup();
    expect(await t.mutation(api.example.reserve, { slug: "", resourceRef: "x" })).toEqual({
      ok: false,
      reason: "SLUG_INVALID",
    });
    expect(
      await t.mutation(api.example.reserve, { slug: "   ", resourceRef: "x" }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
  });

  test("slug below minLength is rejected SLUG_INVALID", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserveStrict, { slug: "ab", resourceRef: "x" });
    expect(r).toEqual({ ok: false, reason: "SLUG_INVALID" });
  });

  test("slug over maxLength is rejected SLUG_INVALID", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserveStrict, {
      slug: "toolongslug",
      resourceRef: "x",
    });
    expect(r).toEqual({ ok: false, reason: "SLUG_INVALID" });
  });

  test("slug failing the charset pattern is rejected SLUG_INVALID", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserveStrict, {
      slug: "Bad_One",
      resourceRef: "x",
    });
    expect(r).toEqual({ ok: false, reason: "SLUG_INVALID" });
  });

  test("reserved word is rejected SLUG_RESERVED", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserveStrict, {
      slug: "admin",
      resourceRef: "x",
    });
    expect(r).toEqual({ ok: false, reason: "SLUG_RESERVED" });
  });

  test("a valid constrained slug reserves", async () => {
    const t = setup();
    const r = await t.mutation(api.example.reserveStrict, {
      slug: "ok-1",
      resourceRef: "x",
    });
    expect(r).toEqual({ ok: true });
    expect(await t.query(api.example.resolve, { slug: "ok-1", scope: "strict" })).toBe("x");
  });

  test("rename target is validated (invalid toSlug rejected)", async () => {
    const t = setup();
    await t.mutation(api.example.reserveStrict, { slug: "src", resourceRef: "x" });
    const reserved = await t.mutation(api.example.renameStrict, {
      fromSlug: "src",
      toSlug: "root",
    });
    expect(reserved).toEqual({ ok: false, reason: "SLUG_RESERVED" });
    const tooShort = await t.mutation(api.example.renameStrict, {
      fromSlug: "src",
      toSlug: "no",
    });
    expect(tooShort).toEqual({ ok: false, reason: "SLUG_INVALID" });
    const ok = await t.mutation(api.example.renameStrict, {
      fromSlug: "src",
      toSlug: "dst",
    });
    expect(ok).toEqual({ ok: true });
  });
});

describe("slugs — component length backstop (hardening)", () => {
  test("component reserve re-guards length even when the client is bypassed", async () => {
    const t = setup();
    // empty after the host bypasses client validation → SLUG_INVALID
    expect(
      await t.mutation(api.example.reserveDirect, {
        slug: "",
        resourceRef: "x",
        minLength: 1,
        maxLength: 10,
      }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
    // over maxLength → SLUG_INVALID
    expect(
      await t.mutation(api.example.reserveDirect, {
        slug: "way-too-long",
        resourceRef: "x",
        minLength: 1,
        maxLength: 4,
      }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
  });

  test("component rename re-guards toSlug length when the client is bypassed", async () => {
    const t = setup();
    await t.mutation(api.example.reserveDirect, {
      slug: "live",
      resourceRef: "x",
      minLength: 1,
      maxLength: 10,
    });
    // below minLength
    expect(
      await t.mutation(api.example.renameDirect, {
        fromSlug: "live",
        toSlug: "ab",
        minLength: 3,
        maxLength: 10,
      }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
    // over maxLength
    expect(
      await t.mutation(api.example.renameDirect, {
        fromSlug: "live",
        toSlug: "way-too-long",
        minLength: 1,
        maxLength: 4,
      }),
    ).toEqual({ ok: false, reason: "SLUG_INVALID" });
  });

  test("rename patches a pre-existing redirect row in place (one per source)", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "src", resourceRef: "r" });
    // seed a stray src→stale redirect coexisting with the live src slug
    await t.mutation(api.example.injectRedirect, { fromSlug: "src", toSlug: "stale" });
    const r = await t.mutation(api.example.rename, { fromSlug: "src", toSlug: "dst" });
    expect(r).toEqual({ ok: true });
    // the existing src redirect was patched, not duplicated
    expect(await t.query(api.example.redirectFor, { slug: "src" })).toBe("dst");
    expect(await t.query(api.example.countRedirects, {})).toBe(1);
  });
});

describe("slugs — duplicate-row degrade (hardening)", () => {
  test("a stray duplicate slug row degrades instead of throwing", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "twin", resourceRef: "first" });
    // inject a stray duplicate (scope, slug) row — Convex indexes are not unique
    // constraints, so a buggy host or a race could leave two rows.
    await t.mutation(api.example.injectDuplicate, {
      slug: "twin",
      resourceRef: "first-dup",
    });
    // resolve / slugForResource must NOT throw on the dup (they use .first())
    expect(await t.query(api.example.resolve, { slug: "twin" })).toBe("first");
    expect(await t.query(api.example.slugForResource, { resourceRef: "first" })).toBe("twin");
    // rename degrades over the dup instead of hard-throwing
    const renamed = await t.mutation(api.example.rename, {
      fromSlug: "twin",
      toSlug: "twin3",
    });
    expect(renamed).toEqual({ ok: true });
    // release of the remaining same-name row is still a no-throw
    expect(await t.mutation(api.example.release, { slug: "twin" })).toBeNull();
  });
});

describe("slugs — release cleans up inbound redirects (fix)", () => {
  test("stale redirect: reserve→rename→release removes the inbound redirect", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "foo", resourceRef: "r1" });
    await t.mutation(api.example.rename, { fromSlug: "foo", toSlug: "bar" });
    // "foo" now redirects to "bar"
    expect(await t.query(api.example.redirectFor, { slug: "foo" })).toBe("bar");
    // release "bar" — should also clear the foo→bar redirect
    await t.mutation(api.example.release, { slug: "bar" });
    // redirectFor("foo") must return null, not the dead "bar"
    expect(await t.query(api.example.redirectFor, { slug: "foo" })).toBeNull();
  });

  test("multi-inbound repoint then release clears all inbound redirects", async () => {
    const t = setup();
    // seed: b is the live slug; a→b and x→b are inbound redirects
    await t.mutation(api.example.reserve, { slug: "mb", resourceRef: "r1" });
    await t.mutation(api.example.injectRedirect, { fromSlug: "ma", toSlug: "mb" });
    await t.mutation(api.example.injectRedirect, { fromSlug: "mx", toSlug: "mb" });
    // rename b→c repoints both inbound redirects to c
    await t.mutation(api.example.rename, { fromSlug: "mb", toSlug: "mc" });
    expect(await t.query(api.example.redirectFor, { slug: "ma" })).toBe("mc");
    expect(await t.query(api.example.redirectFor, { slug: "mx" })).toBe("mc");
    // release mc — clears all three redirects (ma→mc, mx→mc, mb→mc)
    await t.mutation(api.example.release, { slug: "mc" });
    expect(await t.query(api.example.redirectFor, { slug: "ma" })).toBeNull();
    expect(await t.query(api.example.redirectFor, { slug: "mx" })).toBeNull();
  });

  test("release with no inbound redirects is a no-op (idempotent)", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "solo", resourceRef: "s1" });
    // no redirects point at "solo"
    await t.mutation(api.example.release, { slug: "solo" });
    expect(await t.query(api.example.resolve, { slug: "solo" })).toBeNull();
  });
});

describe("slugs — self-rename guard (fix)", () => {
  test("rename slug to itself returns SLUG_TAKEN", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "same", resourceRef: "r1" });
    const r = await t.mutation(api.example.rename, { fromSlug: "same", toSlug: "same" });
    expect(r).toEqual({ ok: false, reason: "SLUG_TAKEN" });
    // the slug must still be held after the rejected self-rename
    expect(await t.query(api.example.resolve, { slug: "same" })).toBe("r1");
    // no redirect row created
    expect(await t.query(api.example.redirectFor, { slug: "same" })).toBeNull();
  });

  test("rename slug to a different target succeeds (guard only blocks self)", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, { slug: "from2", resourceRef: "r2" });
    const r = await t.mutation(api.example.rename, { fromSlug: "from2", toSlug: "to2" });
    expect(r).toEqual({ ok: true });
  });
});

describe("slugs — NFC normalization (fix)", () => {
  test("NFD and NFC forms of the same slug collide (SLUG_TAKEN)", async () => {
    const t = setup();
    // U+0065 + U+0301 (NFD: 'e' + combining acute) — visually identical to U+00E9
    const nfdSlug = "é-handle";
    // U+00E9 (NFC precomposed: 'é') — the composed form
    const nfcSlug = "é-handle";
    // reserve the NFD form — after NFC normalization it becomes the precomposed form
    const r1 = await t.mutation(api.example.reserve, { slug: nfdSlug, resourceRef: "r1" });
    expect(r1).toEqual({ ok: true });
    // reserving the NFC equivalent must be rejected as SLUG_TAKEN
    const r2 = await t.mutation(api.example.reserve, { slug: nfcSlug, resourceRef: "r2" });
    expect(r2).toEqual({ ok: false, reason: "SLUG_TAKEN" });
  });
});

describe("slugs — length boundary (exact)", () => {
  test("slug at exactly minLength succeeds", async () => {
    const t = setup();
    // strictSlugs has minLength:3, maxLength:8, scope:"strict"
    const r = await t.mutation(api.example.reserveStrict, { slug: "abc", resourceRef: "x" });
    expect(r).toEqual({ ok: true });
  });

  test("slug at exactly maxLength succeeds", async () => {
    const t = setup();
    // strictSlugs maxLength:8 — exactly 8 chars
    const r = await t.mutation(api.example.reserveStrict, { slug: "abcd-efg", resourceRef: "y" });
    expect(r).toEqual({ ok: true });
  });
});

describe("slugs — redirect scope isolation", () => {
  test("same fromSlug in two scopes resolves independently", async () => {
    const t = setup();
    await t.mutation(api.example.reserve, {
      slug: "handle",
      resourceRef: "r1",
      scope: "scopeA",
    });
    await t.mutation(api.example.reserve, {
      slug: "handle",
      resourceRef: "r2",
      scope: "scopeB",
    });
    await t.mutation(api.example.rename, {
      fromSlug: "handle",
      toSlug: "handle-v2",
      scope: "scopeA",
    });
    await t.mutation(api.example.rename, {
      fromSlug: "handle",
      toSlug: "handle-v3",
      scope: "scopeB",
    });
    expect(await t.query(api.example.redirectFor, { slug: "handle", scope: "scopeA" })).toBe(
      "handle-v2",
    );
    expect(await t.query(api.example.redirectFor, { slug: "handle", scope: "scopeB" })).toBe(
      "handle-v3",
    );
  });
});
