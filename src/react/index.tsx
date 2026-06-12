/**
 * Optional, tree-shakeable React front-tooling for `@vllnt/convex-slugs`.
 *
 * Thin reactive hooks over `useQuery` from `convex/react`. Each hook takes the
 * HOST's re-exported slug function reference plus its args — the component never
 * imports the host `api`. `react` and `convex/react` are optional peer deps: a
 * backend-only consumer pulls none of this code.
 */

import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";

/**
 * Args accepted by the slug-resolving hooks: a slug plus an optional scope.
 * Declared as a type alias (not an interface) so it satisfies Convex's
 * `DefaultFunctionArgs` index-signature constraint on {@link ResolveRef}.
 */
type ResolveArgs = {
  slug: string;
  scope?: string;
};

/**
 * The host's re-exported `resolve` query reference: takes `{ slug, scope? }`
 * (the host forwards the optional scope to the client) and returns the holding
 * `resourceRef`, or `null` when the slug is free.
 */
type ResolveRef = FunctionReference<
  "query",
  "public",
  ResolveArgs,
  string | null
>;

/** Live handle-availability state for {@link useSlugAvailable}. */
interface SlugAvailability {
  /** `true` when the slug is free, `false` when taken, `undefined` while loading. */
  available: boolean | undefined;
  /** The `resourceRef` holding the slug, or `null` when free / still loading. */
  resourceRef: string | null;
}

/**
 * Reactive handle-availability check — live "is this slug free?" UX. Wraps the
 * host's re-exported `resolve` query: a slug is available exactly when `resolve`
 * returns `null` (no holder).
 *
 * @param resolveRef - The host's re-exported slug `resolve` query reference.
 * @param args - `{ slug, scope? }` the candidate slug and optional scope.
 * @returns `{ available, resourceRef }`. `available` is `undefined` while the
 *   query loads, `true` when the slug is free, `false` when held; `resourceRef`
 *   is the current holder, or `null` when free or loading.
 */
export function useSlugAvailable(
  resolveRef: ResolveRef,
  args: ResolveArgs,
): SlugAvailability {
  const result = useQuery(resolveRef, args);
  return {
    available: result === undefined ? undefined : result === null,
    resourceRef: result ?? null,
  };
}

/**
 * Reactive slug resolution — the `resourceRef` currently holding `slug`, or
 * `null` when free. Wraps the host's re-exported `resolve` query.
 *
 * @param resolveRef - The host's re-exported slug `resolve` query reference.
 * @param args - `{ slug, scope? }` the slug to resolve and optional scope.
 * @returns The held `resourceRef`, `null` when the slug is free, or `undefined`
 *   while the query loads.
 */
export function useResolve(
  resolveRef: ResolveRef,
  args: ResolveArgs,
): string | null | undefined {
  return useQuery(resolveRef, args);
}
