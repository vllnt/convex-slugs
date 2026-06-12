import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { lengthBounds, reserveResult } from "./validators";

/**
 * Reserve `slug` for `resourceRef` within `scope`. The slug arrives already
 * normalized by the client; `bounds` re-guards empty/oversized input at the
 * trust boundary. If the slug was a live redirect target's source, that stale
 * redirect row is removed (the slug is a live name again).
 *
 * @returns `{ ok: true }`, or `{ ok: false, reason }` where reason is
 * `SLUG_INVALID` (empty/over length) or `SLUG_TAKEN` (already held in scope).
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
    if (args.slug.length < Math.max(1, args.bounds.minLength)) {
      return { ok: false, reason: "SLUG_INVALID" as const };
    }
    if (args.slug.length > args.bounds.maxLength) {
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
      await ctx.db.delete(row._id);
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
 * of throwing.
 *
 * @returns `null`.
 */
export const release = mutation({
  args: { scope: v.string(), slug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("slugs")
      .withIndex("by_scope_slug", (q) =>
        q.eq("scope", args.scope).eq("slug", args.slug),
      )
      .first();
    if (existing !== null) {
      await ctx.db.delete(existing._id);
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
 * @returns `{ ok: true }`, or `{ ok: false, reason }` where reason is
 * `SLUG_INVALID` (empty/over length `toSlug`), `SLUG_NOT_FOUND` (`fromSlug` not
 * held), or `SLUG_TAKEN` (`toSlug` already held).
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
    if (args.toSlug.length < Math.max(1, args.bounds.minLength)) {
      return { ok: false, reason: "SLUG_INVALID" as const };
    }
    if (args.toSlug.length > args.bounds.maxLength) {
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
    await ctx.db.patch(from._id, { slug: args.toSlug });

    const inbound = await ctx.db
      .query("redirects")
      .withIndex("by_scope_to", (q) =>
        q.eq("scope", args.scope).eq("toSlug", args.fromSlug),
      )
      .collect();
    for (const row of inbound) {
      await ctx.db.patch(row._id, { toSlug: args.toSlug });
    }

    const existing = await ctx.db
      .query("redirects")
      .withIndex("by_scope_from", (q) =>
        q.eq("scope", args.scope).eq("fromSlug", args.fromSlug),
      )
      .first();
    if (existing !== null) {
      await ctx.db.patch(existing._id, { toSlug: args.toSlug });
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
