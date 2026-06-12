import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Sandboxed tables — the slug registry's own concern. `resourceRef` is an opaque
 * host-owned reference (never assume its shape). Uniqueness is on `(scope, slug)`.
 *
 * `redirects` keeps at most one row per `(scope, fromSlug)`. The `by_scope_to`
 * index lets `rename` repoint chains so `redirectFor` always lands on the live
 * slug (A→B then B→C leaves A→C, not A→B).
 */
export default defineSchema({
  slugs: defineTable({
    scope: v.string(),
    slug: v.string(),
    resourceRef: v.string(),
  })
    .index("by_scope_slug", ["scope", "slug"])
    .index("by_scope_resource", ["scope", "resourceRef"]),
  redirects: defineTable({
    scope: v.string(),
    fromSlug: v.string(),
    toSlug: v.string(),
  })
    .index("by_scope_from", ["scope", "fromSlug"])
    .index("by_scope_to", ["scope", "toSlug"]),
});
