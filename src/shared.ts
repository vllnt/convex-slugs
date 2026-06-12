/** Shared constants + pure utilities used by both `client/` and `component/`. */

export const COMPONENT_NAME = "slugs";

/** Default namespace when the host does not scope a slug. */
export const DEFAULT_SCOPE = "global";

/** Default minimum slug length (after normalization). */
export const DEFAULT_MIN_LENGTH = 1;

/** Default maximum slug length (after normalization). */
export const DEFAULT_MAX_LENGTH = 256;

/** Opaque host-supplied resource reference. Never assume its shape or source. */
export type ResourceRef = string;

/** Stable code-tag for a rejected slug write. */
export type SlugReason =
  | "SLUG_TAKEN"
  | "SLUG_NOT_FOUND"
  | "SLUG_INVALID"
  | "SLUG_RESERVED";

/**
 * Resolved validation config (no optionals) — what {@link validateSlug} checks
 * a normalized slug against.
 */
export interface SlugConstraints {
  minLength: number;
  maxLength: number;
  pattern?: RegExp;
  reservedWords: ReadonlyArray<string>;
}

/**
 * Normalize a slug for storage/lookup. `foldCase` lowercases (the default —
 * handles are case-insensitive); when false the raw case is preserved.
 *
 * @param slug - Raw, host-supplied slug.
 * @param foldCase - Lowercase before comparison when `true`.
 * @returns The trimmed (and optionally lowercased) slug.
 */
export function normalizeSlug(slug: string, foldCase: boolean): string {
  const trimmed = slug.trim();
  return foldCase ? trimmed.toLowerCase() : trimmed;
}

/**
 * Validate an already-normalized slug against {@link SlugConstraints}. Returns a
 * {@link SlugReason} when the slug is rejected, or `null` when it is acceptable.
 *
 * Order: empty/length first (`SLUG_INVALID`), then charset (`SLUG_INVALID`),
 * then reserved words (`SLUG_RESERVED`). Reserved-word matching is exact on the
 * normalized form.
 *
 * @param slug - The normalized slug (output of {@link normalizeSlug}).
 * @param c - Resolved validation constraints.
 * @returns A rejection reason, or `null` when valid.
 */
export function validateSlug(slug: string, c: SlugConstraints): SlugReason | null {
  if (slug.length < Math.max(1, c.minLength)) {
    return "SLUG_INVALID";
  }
  if (slug.length > c.maxLength) {
    return "SLUG_INVALID";
  }
  if (c.pattern !== undefined && !c.pattern.test(slug)) {
    return "SLUG_INVALID";
  }
  if (c.reservedWords.includes(slug)) {
    return "SLUG_RESERVED";
  }
  return null;
}
