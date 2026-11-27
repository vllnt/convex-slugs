# API Reference — @vllnt/convex-slugs

**Compatibility:** `convex@^1.45.0`; optional `react@>=18` for `./react`.

## Entry points

| Import                                     | Exports                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `@vllnt/convex-slugs`                      | `Slugs` class; types `SlugsComponent`, `SlugsOptions`, `SlugWriteResult` |
| `@vllnt/convex-slugs/convex.config`        | Component definition (default export) for `app.use(...)`                 |
| `@vllnt/convex-slugs/react`                | `useSlugAvailable`, `useResolve` (see [React hooks](#react-hooks))       |
| `@vllnt/convex-slugs/test`                 | `register(t, name?)` (see [Testing helper](#testing-helper))             |
| `@vllnt/convex-slugs/_generated/component` | Type `ComponentApi` of the mounted component                             |

`SlugWriteResult` is
`{ ok: boolean; reason?: "SLUG_TAKEN" | "SLUG_NOT_FOUND" | "SLUG_INVALID" | "SLUG_RESERVED" }`.
`./convex.config.js` and `./_generated/component.js` are `.js`-suffixed aliases
of the same entry points. `SlugsComponent` is the shape of `components.slugs`
that `new Slugs(...)` accepts.

Construct the client with the mounted component and optional config:

```ts
import { Slugs } from "@vllnt/convex-slugs";
const slugs = new Slugs(components.slugs, {
  defaultScope: "global", // namespace applied when a call omits `scope`
  foldCase: true, // lowercase slugs before store/lookup
  minLength: 1, // reject shorter (after normalization) as SLUG_INVALID
  maxLength: 256, // reject longer as SLUG_INVALID
  pattern: /^[a-z0-9-]+$/, // optional charset; failing it is SLUG_INVALID
  reservedWords: ["admin"], // reject these (normalized) as SLUG_RESERVED
});
```

All methods take the host `ctx` (a query or mutation context) as the first
argument. `scope` is optional and defaults to `defaultScope`.

**Normalization pipeline:** raw slug → `String.prototype.normalize("NFC")` →
`.trim()` → optional `.toLowerCase()` (when `foldCase: true`). This ensures
visually-identical slugs with different Unicode compositions (e.g. precomposed
vs. combining-character forms) are treated as the same string.

Limits to know: `minLength`/`maxLength` count UTF-16 code units (an emoji is 2),
and there is no compatibility folding (NFKC), confusable detection, or
zero-width-character stripping. Use `pattern` (for example `/^[a-z0-9-]+$/`) to
restrict the alphabet. Reserved words are normalized the same way as slugs, so
`reservedWords: ["Admin"]` blocks `admin`.

## Validation reasons

Expected validation and conflict rejections return `{ ok: false, reason }`. This
does not cover every failure: invalid regular-expression configuration, Convex
validation, authorization in host wrappers, and runtime failures can throw.
`reason` is a typed string-literal union:

| Reason           | When                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `SLUG_INVALID`   | Empty/whitespace, outside `minLength`..`maxLength`, or fails `pattern`. |
| `SLUG_RESERVED`  | The normalized slug is in `reservedWords`.                              |
| `SLUG_TAKEN`     | The slug is already held in the scope.                                  |
| `SLUG_NOT_FOUND` | `rename` was called for a `fromSlug` that is not held.                  |

Validation runs in the client against the resolved options before any
round-trip; the component re-guards length at the trust boundary even if a
caller bypasses the client.

## Errors

Malformed input throws a `ConvexError` whose `data.code` is stable:

| Code               | Thrown by           | When                                                                                                                   |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `INVALID_OPTIONS`  | `new Slugs(...)`    | Empty `defaultScope`, or `minLength`/`maxLength` not integers with `0 <= minLength <= maxLength` and `maxLength >= 1`. |
| `INVALID_ARGUMENT` | component mutations | Empty `scope` or `resourceRef`, or `bounds` that are not integers with `minLength <= maxLength`.                       |

## Concurrency

`reserve` and `rename` each run as one Convex mutation, which is serializable.
When several callers claim the same slug at once, exactly one succeeds and the
others receive `SLUG_TAKEN`. Convex indexes are not unique constraints, so
always claim through these mutations.

## Mutations

### `reserve(ctx, slug, resourceRef, scope?) → { ok, reason? }`

Reserve `slug` for `resourceRef`. Returns `{ ok: true }` on success, or
`{ ok: false, reason }` with `SLUG_INVALID`, `SLUG_RESERVED`, or `SLUG_TAKEN`.
Reserving a slug that was previously renamed away clears its now-dangling
redirect (the slug is a live name again).

### `release(ctx, slug, scope?) → null`

Release `slug`. Idempotent — releasing an unheld slug is a no-op. Also deletes
all `redirects` rows whose `toSlug` equals the released slug, so
`redirectFor(old)` returns `null` after release instead of pointing at a dead
target.

### `rename(ctx, fromSlug, toSlug, scope?) → { ok, reason? }`

Move `fromSlug` to `toSlug` and record an old → new redirect. Returns
`SLUG_INVALID` (bad `toSlug`), `SLUG_RESERVED` (reserved `toSlug`),
`SLUG_NOT_FOUND` (`fromSlug` not held), or `SLUG_TAKEN` (`toSlug` already held
or equals `fromSlug`). Self-rename (`fromSlug === toSlug`) is rejected with
`SLUG_TAKEN` before any DB read. Existing redirects that pointed at `fromSlug`
are repointed to `toSlug`, so a chain A→B→C collapses to A→C; at most one
redirect row is kept per `(scope, fromSlug)`. Renaming back to an earlier name
(A→B, then B→A) removes the redirect that left A, so a live slug never has a
redirect and redirects never loop.

## Queries

### `resolve(ctx, slug, scope?) → resourceRef | null`

The `resourceRef` currently holding `slug`, or `null`.

### `redirectFor(ctx, slug, scope?) → toSlug | null`

If `slug` was renamed away, the live slug it now points to (chains collapsed);
otherwise `null`.

### `slugForResource(ctx, resourceRef, scope?) → slug | null`

The slug currently held by `resourceRef`, or `null`. Assumes one slug per
`(scope, resourceRef)` (the host reserves at most one).

## React hooks

`@vllnt/convex-slugs/react` wraps `useQuery` from `convex/react`. Each hook
takes the host's own public query that forwards `{ slug, scope? }` to
`slugs.resolve` and returns `string | null`; the component's internal queries
cannot be called from a browser.

### `useSlugAvailable(resolveRef, { slug, scope? }) → { available, resourceRef }`

`available` is `undefined` while loading, `true` when the slug is free, and
`false` when held. `resourceRef` is the holder, or `null` when free or loading.
Availability is a lookup hint: it does not check length, `pattern` or reserved
words, and a concurrent claim can still win, so always check `reserve`'s result.

### `useResolve(resolveRef, { slug, scope? }) → resourceRef | null | undefined`

The holding `resourceRef`, `null` when free, or `undefined` while loading.

## Testing helper

### `register(t, name = "slugs") → void`

From `@vllnt/convex-slugs/test`. Mounts the component in a `convex-test`
instance under `name`. The helper ships as TypeScript source and uses Vite's
`import.meta.glob`, so the consuming tests need `convex-test` and `vitest`.
