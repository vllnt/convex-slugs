import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Slugs } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass an
 * opaque `resourceRef` (and optional `scope`) into the slugs client.
 */
const slugs = new Slugs(components.slugs);

/** A second client with non-default options (custom scope + case-sensitive). */
const tenantSlugs = new Slugs(components.slugs, {
  defaultScope: "tenant",
  foldCase: false,
});

/** A constrained client — exercises length / pattern / reserved-word rejection. */
const strictSlugs = new Slugs(components.slugs, {
  defaultScope: "strict",
  minLength: 3,
  maxLength: 8,
  pattern: /^[a-z0-9-]+$/,
  reservedWords: ["admin", "root"],
});

const writeResult = v.object({
  ok: v.boolean(),
  reason: v.optional(
    v.union(
      v.literal("SLUG_TAKEN"),
      v.literal("SLUG_NOT_FOUND"),
      v.literal("SLUG_INVALID"),
      v.literal("SLUG_RESERVED"),
    ),
  ),
});
const maybeString = v.union(v.null(), v.string());

export const reserve = mutation({
  args: { slug: v.string(), resourceRef: v.string(), scope: v.optional(v.string()) },
  returns: writeResult,
  handler: (ctx, a) => slugs.reserve(ctx, a.slug, a.resourceRef, a.scope),
});

export const release = mutation({
  args: { slug: v.string(), scope: v.optional(v.string()) },
  returns: v.null(),
  handler: (ctx, a) => slugs.release(ctx, a.slug, a.scope),
});

export const rename = mutation({
  args: { fromSlug: v.string(), toSlug: v.string(), scope: v.optional(v.string()) },
  returns: writeResult,
  handler: (ctx, a) => slugs.rename(ctx, a.fromSlug, a.toSlug, a.scope),
});

export const resolve = query({
  args: { slug: v.string(), scope: v.optional(v.string()) },
  returns: maybeString,
  handler: (ctx, a) => slugs.resolve(ctx, a.slug, a.scope),
});

export const redirectFor = query({
  args: { slug: v.string(), scope: v.optional(v.string()) },
  returns: maybeString,
  handler: (ctx, a) => slugs.redirectFor(ctx, a.slug, a.scope),
});

export const slugForResource = query({
  args: { resourceRef: v.string(), scope: v.optional(v.string()) },
  returns: maybeString,
  handler: (ctx, a) => slugs.slugForResource(ctx, a.resourceRef, a.scope),
});

/** Case-sensitive, tenant-scoped variants — exercise the client's option branches. */
export const reserveRaw = mutation({
  args: { slug: v.string(), resourceRef: v.string() },
  returns: writeResult,
  handler: (ctx, a) => tenantSlugs.reserve(ctx, a.slug, a.resourceRef),
});

export const resolveRaw = query({
  args: { slug: v.string() },
  returns: maybeString,
  handler: (ctx, a) => tenantSlugs.resolve(ctx, a.slug),
});

/** Constrained variants — exercise length / pattern / reserved-word validation. */
export const reserveStrict = mutation({
  args: { slug: v.string(), resourceRef: v.string() },
  returns: writeResult,
  handler: (ctx, a) => strictSlugs.reserve(ctx, a.slug, a.resourceRef),
});

export const renameStrict = mutation({
  args: { fromSlug: v.string(), toSlug: v.string() },
  returns: writeResult,
  handler: (ctx, a) => strictSlugs.rename(ctx, a.fromSlug, a.toSlug),
});

/**
 * Test-only host wrapper around the component's `insertRaw` escape hatch — used
 * to simulate a stray duplicate `(scope, slug)` row in the degrade test.
 */
export const injectDuplicate = mutation({
  args: { slug: v.string(), resourceRef: v.string(), scope: v.optional(v.string()) },
  returns: v.null(),
  handler: (ctx, a) =>
    ctx.runMutation(components.slugs.mutations.insertRaw, {
      scope: a.scope ?? "global",
      slug: a.slug,
      resourceRef: a.resourceRef,
    }),
});

/** Test-only host wrapper around the component's `countRedirects` inspector. */
export const countRedirects = query({
  args: { scope: v.optional(v.string()) },
  returns: v.number(),
  handler: (ctx, a) =>
    ctx.runQuery(components.slugs.queries.countRedirects, {
      scope: a.scope ?? "global",
    }),
});

/** Test-only host wrapper around the component's `insertRedirectRaw` escape hatch. */
export const injectRedirect = mutation({
  args: { fromSlug: v.string(), toSlug: v.string(), scope: v.optional(v.string()) },
  returns: v.null(),
  handler: (ctx, a) =>
    ctx.runMutation(components.slugs.mutations.insertRedirectRaw, {
      scope: a.scope ?? "global",
      fromSlug: a.fromSlug,
      toSlug: a.toSlug,
    }),
});

/**
 * Test-only: call the component `reserve` directly with explicit bounds, bypassing
 * the client's pre-validation, to exercise the component's own length backstop.
 */
export const reserveDirect = mutation({
  args: {
    slug: v.string(),
    resourceRef: v.string(),
    minLength: v.number(),
    maxLength: v.number(),
  },
  returns: writeResult,
  handler: (ctx, a) =>
    ctx.runMutation(components.slugs.mutations.reserve, {
      scope: "global",
      slug: a.slug,
      resourceRef: a.resourceRef,
      bounds: { minLength: a.minLength, maxLength: a.maxLength },
    }),
});

/**
 * Test-only: call the component `rename` directly with explicit bounds, bypassing
 * the client's pre-validation, to exercise the component's own length backstop.
 */
export const renameDirect = mutation({
  args: {
    fromSlug: v.string(),
    toSlug: v.string(),
    minLength: v.number(),
    maxLength: v.number(),
  },
  returns: writeResult,
  handler: (ctx, a) =>
    ctx.runMutation(components.slugs.mutations.rename, {
      scope: "global",
      fromSlug: a.fromSlug,
      toSlug: a.toSlug,
      bounds: { minLength: a.minLength, maxLength: a.maxLength },
    }),
});
