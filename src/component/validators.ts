import { v } from "convex/values";

/**
 * Stable code-tag for a rejected slug write, as a Convex validator union. Kept
 * in lockstep with the `SlugReason` string-literal union in `src/shared.ts`.
 */
export const slugReason = v.union(
  v.literal("SLUG_TAKEN"),
  v.literal("SLUG_NOT_FOUND"),
  v.literal("SLUG_INVALID"),
  v.literal("SLUG_RESERVED"),
);

/**
 * Result of a write that may be rejected. `reason` carries a stable code-tag
 * (one of {@link slugReason}) when `ok` is `false`, and is absent when `ok` is
 * `true`.
 */
export const reserveResult = v.object({
  ok: v.boolean(),
  reason: v.optional(slugReason),
});

/**
 * Numeric length backstop applied inside the component. The client owns the full
 * config (charset, reserved words); these bounds re-guard empty/oversized slugs
 * at the trust boundary even if a caller bypasses the client class.
 */
export const lengthBounds = v.object({
  minLength: v.number(),
  maxLength: v.number(),
});
