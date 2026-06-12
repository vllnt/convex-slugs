import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

/**
 * Resolve `slug` to the `resourceRef` currently holding it within `scope`, or
 * `null`. Uses `.first()` so a stray duplicate row degrades to one answer
 * instead of throwing.
 *
 * @returns The held `resourceRef`, or `null` when the slug is free.
 */
export const resolve = query({
  args: { scope: v.string(), slug: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("slugs")
      .withIndex("by_scope_slug", (q) =>
        q.eq("scope", args.scope).eq("slug", args.slug),
      )
      .first();
    return row === null ? null : row.resourceRef;
  },
});

/**
 * Where a renamed `slug` now points within `scope`. After chain repointing this
 * is always the live slug (A→B→C resolves A to C), or `null` when `slug` was
 * never renamed away.
 *
 * @returns The current target slug, or `null`.
 */
export const redirectFor = query({
  args: { scope: v.string(), slug: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redirects")
      .withIndex("by_scope_from", (q) =>
        q.eq("scope", args.scope).eq("fromSlug", args.slug),
      )
      .order("desc")
      .first();
    return row === null ? null : row.toSlug;
  },
});

/**
 * The slug currently held by `resourceRef` within `scope`. Assumes one slug per
 * `(scope, resourceRef)` (the host reserves at most one); returns the first if
 * the host violated that, or `null` when the resource holds none.
 *
 * @returns The held slug, or `null`.
 */
export const slugForResource = query({
  args: { scope: v.string(), resourceRef: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("slugs")
      .withIndex("by_scope_resource", (q) =>
        q.eq("scope", args.scope).eq("resourceRef", args.resourceRef),
      )
      .first();
    return row === null ? null : row.slug;
  },
});

/**
 * Test/inspection escape hatch: count `redirects` rows in `scope`. `internalQuery`,
 * never part of the public client API. Used to assert the one-row-per-source
 * bound (redirect chains repoint in place rather than accumulate).
 *
 * @returns The number of redirect rows in the scope.
 */
export const countRedirects = internalQuery({
  args: { scope: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("redirects")
      .withIndex("by_scope_from", (q) => q.eq("scope", args.scope))
      .collect();
    return rows.length;
  },
});
