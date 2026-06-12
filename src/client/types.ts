/** Public TypeScript surface for the slugs client. */

import type { SlugReason } from "../shared.js";

/** Result of a slug write that may be rejected. */
export interface SlugWriteResult {
  ok: boolean;
  /**
   * Stable code-tag when `ok` is false:
   * `SLUG_TAKEN` | `SLUG_NOT_FOUND` | `SLUG_INVALID` | `SLUG_RESERVED`.
   */
  reason?: SlugReason;
}

/** Construction options for the {@link Slugs} client. */
export interface SlugsOptions {
  /** Namespace applied when a call omits `scope`. Default `"global"`. */
  defaultScope?: string;
  /** Lowercase slugs before store/lookup (case-insensitive handles). Default `true`. */
  foldCase?: boolean;
  /** Minimum slug length after normalization. Default `1`. */
  minLength?: number;
  /** Maximum slug length after normalization. Default `256`. */
  maxLength?: number;
  /** Allowed charset; a slug failing it is rejected `SLUG_INVALID`. Default: none. */
  pattern?: RegExp;
  /** Slugs rejected with `SLUG_RESERVED` (matched on the normalized form). Default `[]`. */
  reservedWords?: string[];
}
