import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import type { SlugsOptions, SlugWriteResult } from "./types.js";
import {
  DEFAULT_MAX_LENGTH,
  DEFAULT_MIN_LENGTH,
  DEFAULT_SCOPE,
  normalizeSlug,
  validateSlug,
} from "../shared.js";
import type { SlugConstraints } from "../shared.js";

/** Numeric length backstop forwarded to the component on each write. */
interface LengthBounds {
  minLength: number;
  maxLength: number;
}

/**
 * The slug component's function references, as exposed on the host via
 * `components.slugs`.
 */
export interface SlugsComponent {
  mutations: {
    reserve: FunctionReference<
      "mutation",
      "internal",
      { scope: string; slug: string; resourceRef: string; bounds: LengthBounds },
      SlugWriteResult
    >;
    release: FunctionReference<
      "mutation",
      "internal",
      { scope: string; slug: string },
      null
    >;
    rename: FunctionReference<
      "mutation",
      "internal",
      { scope: string; fromSlug: string; toSlug: string; bounds: LengthBounds },
      SlugWriteResult
    >;
  };
  queries: {
    resolve: FunctionReference<
      "query",
      "internal",
      { scope: string; slug: string },
      string | null
    >;
    redirectFor: FunctionReference<
      "query",
      "internal",
      { scope: string; slug: string },
      string | null
    >;
    slugForResource: FunctionReference<
      "query",
      "internal",
      { scope: string; resourceRef: string },
      string | null
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for the unique slug / handle registry. The host owns
 * meaning and auth; it passes an opaque `resourceRef` and an optional `scope`.
 *
 * Slug validation (length, charset, reserved words) runs here against the
 * resolved {@link SlugsOptions}; the component re-guards length at the trust
 * boundary. An invalid write short-circuits to a typed result with no round-trip.
 */
export class Slugs {
  private readonly defaultScope: string;
  private readonly foldCase: boolean;
  private readonly constraints: SlugConstraints;

  constructor(
    private readonly component: SlugsComponent,
    options: SlugsOptions = {},
  ) {
    this.defaultScope = options.defaultScope ?? DEFAULT_SCOPE;
    this.foldCase = options.foldCase ?? true;
    this.constraints = {
      minLength: options.minLength ?? DEFAULT_MIN_LENGTH,
      maxLength: options.maxLength ?? DEFAULT_MAX_LENGTH,
      pattern: options.pattern,
      reservedWords: options.reservedWords ?? [],
    };
  }

  private norm(slug: string): string {
    return normalizeSlug(slug, this.foldCase);
  }

  private scopeOf(scope: string | undefined): string {
    return scope ?? this.defaultScope;
  }

  private get bounds(): LengthBounds {
    return {
      minLength: this.constraints.minLength,
      maxLength: this.constraints.maxLength,
    };
  }

  /**
   * Reserve `slug` for `resourceRef`. Returns `{ ok: false, reason }` when the
   * slug is invalid (`SLUG_INVALID`), reserved (`SLUG_RESERVED`), or already held
   * (`SLUG_TAKEN`).
   */
  reserve(
    ctx: RunMutationCtx,
    slug: string,
    resourceRef: string,
    scope?: string,
  ): Promise<SlugWriteResult> {
    const normalized = this.norm(slug);
    const reason = validateSlug(normalized, this.constraints);
    if (reason !== null) {
      return Promise.resolve({ ok: false, reason });
    }
    return ctx.runMutation(this.component.mutations.reserve, {
      scope: this.scopeOf(scope),
      slug: normalized,
      resourceRef,
      bounds: this.bounds,
    });
  }

  /** Release `slug` (idempotent — releasing an unheld slug is a no-op). */
  release(ctx: RunMutationCtx, slug: string, scope?: string): Promise<null> {
    return ctx.runMutation(this.component.mutations.release, {
      scope: this.scopeOf(scope),
      slug: this.norm(slug),
    });
  }

  /**
   * Rename `fromSlug` to `toSlug`, recording a redirect. The `toSlug` is
   * validated; an invalid target short-circuits to `{ ok: false, reason }`.
   */
  rename(
    ctx: RunMutationCtx,
    fromSlug: string,
    toSlug: string,
    scope?: string,
  ): Promise<SlugWriteResult> {
    const normalizedTo = this.norm(toSlug);
    const reason = validateSlug(normalizedTo, this.constraints);
    if (reason !== null) {
      return Promise.resolve({ ok: false, reason });
    }
    return ctx.runMutation(this.component.mutations.rename, {
      scope: this.scopeOf(scope),
      fromSlug: this.norm(fromSlug),
      toSlug: normalizedTo,
      bounds: this.bounds,
    });
  }

  /** Resolve `slug` to its `resourceRef`, or `null`. */
  resolve(ctx: RunQueryCtx, slug: string, scope?: string): Promise<string | null> {
    return ctx.runQuery(this.component.queries.resolve, {
      scope: this.scopeOf(scope),
      slug: this.norm(slug),
    });
  }

  /** Where a renamed `slug` now points (`toSlug`), or `null`. */
  redirectFor(
    ctx: RunQueryCtx,
    slug: string,
    scope?: string,
  ): Promise<string | null> {
    return ctx.runQuery(this.component.queries.redirectFor, {
      scope: this.scopeOf(scope),
      slug: this.norm(slug),
    });
  }

  /** The slug currently held by `resourceRef`, or `null`. */
  slugForResource(
    ctx: RunQueryCtx,
    resourceRef: string,
    scope?: string,
  ): Promise<string | null> {
    return ctx.runQuery(this.component.queries.slugForResource, {
      scope: this.scopeOf(scope),
      resourceRef,
    });
  }
}

export type { SlugsOptions, SlugWriteResult };
