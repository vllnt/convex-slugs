import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server.js";
import { lengthBounds, reserveResult } from "./validators.js";

/**
 * Hard cap, in UTF-16 code units (`string.length`), on the slug, `scope` and
 * `resourceRef` that `reserve` and `rename` write. It holds whatever `bounds`
 * the caller passes. `release` and the queries do not apply it, so rows stored
 * by an older version with longer values stay readable and removable.
 */
const MAX_INPUT_LENGTH = 1024;

/**
 * Reject malformed arguments with `ConvexError({ code: "INVALID_ARGUMENT" })`.
 * Expected slug rejections stay typed `{ ok: false, reason }` results; this
 * covers input no correct client sends (empty scope/ref, non-integer bounds,
 * and on writes a scope or ref over {@link MAX_INPUT_LENGTH}).
 */
function assertArgs(args: {
  scope: string;
  resourceRef?: string;
  bounds?: { minLength: number; maxLength: number };
}): void {
  const { scope, resourceRef, bounds } = args;
  // Only `reserve` and `rename` pass `bounds`; they are the size-capped writes.
  const isWrite = bounds !== undefined;
  const badBounds =
    isWrite &&
    !(
      Number.isInteger(bounds.minLength) &&
      Number.isInteger(bounds.maxLength) &&
      bounds.minLength <= bounds.maxLength
    );
  const oversized =
    isWrite &&
    (scope.length > MAX_INPUT_LENGTH ||
      (resourceRef ?? "").length > MAX_INPUT_LENGTH);
  if (scope === "" || resourceRef === "" || badBounds || oversized) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT",
      message: `scope and resourceRef must be non-empty, and at most ${String(MAX_INPUT_LENGTH)} UTF-16 code units on reserve and rename; bounds must be integers with min <= max`,
    });
  }
}

/** Whether a slug to be written is empty, outside `bounds`, or over the cap. */
function slugOutOfBounds(
  slug: string,
  bounds: { minLength: number; maxLength: number },
): boolean {
  return (
    slug.length < Math.max(1, bounds.minLength) ||
    slug.length > Math.min(bounds.maxLength, MAX_INPUT_LENGTH)
  );
}

/**
 * Reserve `slug` for `resourceRef` within `scope`. The slug arrives already
 * normalized by the client; `bounds` re-guards empty/oversized input at the
 * trust boundary. If the slug was a live redirect target's source, that stale
 * redirect row is removed (the slug is a live name again).
 *
 * @returns `{ ok: true }`, or `{ ok: false, reason }` where reason is
 * `SLUG_INVALID` (empty, outside `bounds` or over {@link MAX_INPUT_LENGTH}) or
 * `SLUG_TAKEN` (already held in scope).
 * @throws `INVALID_ARGUMENT` for an empty, or over-cap, `scope` or `resourceRef`.
 */
export const reserve = mutation({
  args: {
    scope: v.string(),
    slug: v.string(),
    resourceRef: v.string(),
    bounds: lengthBounds,
  },
  returns: reserveResult,
  handler: async (ctx, args) => {
    assertArgs(args);
    if (slugOutOfBounds(args.slug, args.bounds)) {
      return { ok: false, reason: "SLUG_INVALID" as const };
    }
    const existing = await ctx.db
      .query("slugs")
      .withIndex("by_scope_slug", (q) =>
        q.eq("scope", args.scope).eq("slug", args.slug),
      )
      .first();
    if (existing !== null) {
      return { ok: false, reason: "SLUG_TAKEN" as const };
    }
    const dangling = await ctx.db
      .query("redirects")
      .withIndex("by_scope_from", (q) =>
        q.eq("scope", args.scope).eq("fromSlug", args.slug),
      )
      .collect();
    for (const row of dangling) {
      await ctx.db.delete("redirects", row._id);
    }
    await ctx.db.insert("slugs", {
      scope: args.scope,
      slug: args.slug,
      resourceRef: args.resourceRef,
    });
    return { ok: true };
  },
});

/**
 * Release `slug` from `scope`. Idempotent — releasing an unheld slug is a no-op.
 * Uses `.first()` so a stray duplicate row degrades to releasing one row instead
 * of throwing. Also deletes all `redirects` rows whose `toSlug` equals the
 * released slug so that `redirectFor(old)` returns `null` after release rather
 * than pointing at a now-dead target.
 *
 * @returns `null`.
 */
export const release = mutation({
  args: { scope: v.string(), slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertArgs(args);
    const existing = await ctx.db
      .query("slugs")
      .withIndex("by_scope_slug", (q) =>
        q.eq("scope", args.scope).eq("slug", args.slug),
      )
      .first();
    if (existing !== null) {
      await ctx.db.delete("slugs", existing._id);
    }
    const inbound = await ctx.db
      .query("redirects")
      .withIndex("by_scope_to", (q) =>
        q.eq("scope", args.scope).eq("toSlug", args.slug),
      )
      .collect();
    for (const row of inbound) {
      await ctx.db.delete("redirects", row._id);
    }
    return null;
  },
});

/**
 * Rename `fromSlug` to `toSlug` within `scope` and record a redirect. `toSlug`
 * arrives normalized; `bounds` re-guards it. On success the slug row is patched,
 * existing redirects that pointed at `fromSlug` are repointed to `toSlug` (so a
 * chain A→B→C collapses to A→C), and a single redirect row per `(scope,
 * fromSlug)` is upserted (patched if present, else inserted) to bound growth.
 *
 * Any redirect leaving `toSlug` is removed (it is a live name again), so no
 * redirect ever starts at a live slug.
 *
 * Self-rename (`fromSlug === toSlug`) is rejected with `SLUG_TAKEN` before any
 * DB read, preventing a self-loop redirect from being created.
 *
 * `fromSlug` is not size-capped: it is only a lookup key, so a value over the
 * cap writes nothing unless an older version stored it, and renaming such a
 * legacy row to a short `toSlug` is the way to bring it under the cap.
 *
 * @returns `{ ok: true }`, or `{ ok: false, reason }` where reason is
 * `SLUG_INVALID` (empty, outside `bounds` or over {@link MAX_INPUT_LENGTH}
 * `toSlug`), `SLUG_NOT_FOUND` (`fromSlug` not held), or `SLUG_TAKEN` (`toSlug`
 * already held or equals `fromSlug`).
 * @throws `INVALID_ARGUMENT` for an empty, or over-cap, `scope`.
 */
export const rename = mutation({
  args: {
    scope: v.string(),
    fromSlug: v.string(),
    toSlug: v.string(),
    bounds: lengthBounds,
  },
  returns: reserveResult,
  handler: async (ctx, args) => {
    assertArgs(args);
    if (args.fromSlug === args.toSlug) {
      return { ok: false, reason: "SLUG_TAKEN" as const };
    }
    if (slugOutOfBounds(args.toSlug, args.bounds)) {
      return { ok: false, reason: "SLUG_INVALID" as const };
    }
    const from = await ctx.db
      .query("slugs")
      .withIndex("by_scope_slug", (q) =>
        q.eq("scope", args.scope).eq("slug", args.fromSlug),
      )
      .first();
    if (from === null) {
      return { ok: false, reason: "SLUG_NOT_FOUND" as const };
    }
    const taken = await ctx.db
      .query("slugs")
      .withIndex("by_scope_slug", (q) =>
        q.eq("scope", args.scope).eq("slug", args.toSlug),
      )
      .first();
    if (taken !== null) {
      return { ok: false, reason: "SLUG_TAKEN" as const };
    }
    await ctx.db.patch("slugs", from._id, { slug: args.toSlug });

    // `toSlug` is a live name again: drop its own redirect first, so renaming
    // back (A->B, B->A) cannot repoint it into a self-loop A->A below.
    const stale = await ctx.db
      .query("redirects")
      .withIndex("by_scope_from", (q) =>
        q.eq("scope", args.scope).eq("fromSlug", args.toSlug),
      )
      .collect();
    for (const row of stale) {
      await ctx.db.delete("redirects", row._id);
    }

    const inbound = await ctx.db
      .query("redirects")
      .withIndex("by_scope_to", (q) =>
        q.eq("scope", args.scope).eq("toSlug", args.fromSlug),
      )
      .collect();
    for (const row of inbound) {
      await ctx.db.patch("redirects", row._id, { toSlug: args.toSlug });
    }

    const existing = await ctx.db
      .query("redirects")
      .withIndex("by_scope_from", (q) =>
        q.eq("scope", args.scope).eq("fromSlug", args.fromSlug),
      )
      .first();
    if (existing !== null) {
      await ctx.db.patch("redirects", existing._id, { toSlug: args.toSlug });
    } else {
      await ctx.db.insert("redirects", {
        scope: args.scope,
        fromSlug: args.fromSlug,
        toSlug: args.toSlug,
      });
    }
    return { ok: true };
  },
});

/**
 * Test/repair escape hatch: insert a `slugs` row with no uniqueness check.
 * `internalMutation`, so it is never part of the public client API. Used to
 * simulate a stray duplicate `(scope, slug)` row (Convex indexes are not unique
 * constraints) and verify reads degrade via `.first()` instead of throwing.
 *
 * @returns `null`.
 */
export const insertRaw = internalMutation({
  args: { scope: v.string(), slug: v.string(), resourceRef: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("slugs", {
      scope: args.scope,
      slug: args.slug,
      resourceRef: args.resourceRef,
    });
    return null;
  },
});

/**
 * Test/repair escape hatch: insert a `redirects` row directly. `internalMutation`,
 * never part of the public client API. Used to seed a `(scope, fromSlug)`
 * redirect that coexists with a live slug so `rename`'s upsert-patch branch (one
 * row per source) is exercised.
 *
 * @returns `null`.
 */
export const insertRedirectRaw = internalMutation({
  args: { scope: v.string(), fromSlug: v.string(), toSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("redirects", {
      scope: args.scope,
      fromSlug: args.fromSlug,
      toSlug: args.toSlug,
    });
    return null;
  },
});
