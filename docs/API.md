# API Reference — @vllnt/convex-slugs

Construct the client with the mounted component and optional config:

```ts
import { Slugs } from "@vllnt/convex-slugs";
const slugs = new Slugs(components.slugs, {
  defaultScope: "global", // namespace applied when a call omits `scope`
  foldCase: true,         // lowercase slugs before store/lookup
  minLength: 1,           // reject shorter (after normalization) as SLUG_INVALID
  maxLength: 256,         // reject longer as SLUG_INVALID
  pattern: /^[a-z0-9-]+$/, // optional charset; failing it is SLUG_INVALID
  reservedWords: ["admin"], // reject these (normalized) as SLUG_RESERVED
});
```

All methods take the host `ctx` (a query or mutation context) as the first
argument. `scope` is optional and defaults to `defaultScope`.

## Validation reasons

A rejected write returns `{ ok: false, reason }`. `reason` is a typed
string-literal union:

| Reason | When |
|--------|------|
| `SLUG_INVALID` | Empty/whitespace, outside `minLength`..`maxLength`, or fails `pattern`. |
| `SLUG_RESERVED` | The normalized slug is in `reservedWords`. |
| `SLUG_TAKEN` | The slug is already held in the scope. |
| `SLUG_NOT_FOUND` | `rename` was called for a `fromSlug` that is not held. |

Validation runs in the client against the resolved options before any
round-trip; the component re-guards length at the trust boundary even if a
caller bypasses the client.

## Mutations

### `reserve(ctx, slug, resourceRef, scope?) → { ok, reason? }`

Reserve `slug` for `resourceRef`. Returns `{ ok: true }` on success, or
`{ ok: false, reason }` with `SLUG_INVALID`, `SLUG_RESERVED`, or `SLUG_TAKEN`.
Reserving a slug that was previously renamed away clears its now-dangling
redirect (the slug is a live name again).

### `release(ctx, slug, scope?) → null`

Release `slug`. Idempotent — releasing an unheld slug is a no-op.

### `rename(ctx, fromSlug, toSlug, scope?) → { ok, reason? }`

Move `fromSlug` to `toSlug` and record an old → new redirect. Returns
`SLUG_INVALID` (bad `toSlug`), `SLUG_NOT_FOUND` (`fromSlug` not held), or
`SLUG_TAKEN` (`toSlug` already held). Existing redirects that pointed at
`fromSlug` are repointed to `toSlug`, so a chain A→B→C collapses to A→C; at most
one redirect row is kept per `(scope, fromSlug)`.

## Queries

### `resolve(ctx, slug, scope?) → resourceRef | null`

The `resourceRef` currently holding `slug`, or `null`.

### `redirectFor(ctx, slug, scope?) → toSlug | null`

If `slug` was renamed away, the live slug it now points to (chains collapsed);
otherwise `null`.

### `slugForResource(ctx, resourceRef, scope?) → slug | null`

The slug currently held by `resourceRef`, or `null`. Assumes one slug per
`(scope, resourceRef)` (the host reserves at most one).
