# API Reference — @vllnt/convex-slugs

**Compatibility:** `convex@^1.45.0`; optional `react@>=18` for `./react`.

## Entry points

| Import                                                | Exports                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `@vllnt/convex-slugs`                                 | `Slugs` class; types `SlugsComponent`, `SlugsOptions`, `SlugWriteResult` |
| `@vllnt/convex-slugs/convex.config` (or `.js`)        | default component config for `app.use(...)`                              |
| `@vllnt/convex-slugs/react`                           | `useSlugAvailable`, `useResolve`                                         |
| `@vllnt/convex-slugs/test`                            | `register(t, name = "slugs")` for `convex-test` (TypeScript source)      |
| `@vllnt/convex-slugs/_generated/component` (or `.js`) | type `ComponentApi`                                                      |

`resourceRef` and `scope` are opaque host strings; slugs are normalized (see
[Normalization](#normalization)). Every method's
`scope` defaults to the client's `defaultScope`. `resourceRef` is stored and
returned as given; the component never reads its meaning.

## Client

### `Slugs`

```ts
new Slugs(component: SlugsComponent, options?: SlugsOptions)
```

`component` is the mounted component, `components.slugs` (or the name passed to
`app.use`). Call the methods from host mutations (`ctx.runMutation`) and
queries (`ctx.runQuery`); actions work too. The constructor throws
`INVALID_OPTIONS` for invalid [options](#slugsoptions).

```ts
import { Slugs } from "@vllnt/convex-slugs";
import type { SlugsComponent } from "@vllnt/convex-slugs";

declare const component: SlugsComponent;

const slugs = new Slugs(component, {
  defaultScope: "global", // namespace applied when a call omits `scope`
  foldCase: true, // lowercase slugs before store and lookup
  minLength: 1, // shorter (after normalization) is SLUG_INVALID
  maxLength: 256, // longer (after normalization) is SLUG_INVALID
  pattern: /^[a-z0-9-]+$/, // optional; failing it is SLUG_INVALID
  reservedWords: ["admin"], // normalized like slugs; a match is SLUG_RESERVED
});
```

Every method normalizes its slug arguments first (see
[Normalization](#normalization)). `reserve` and `rename` validate the
normalized slug against the options before any database call; an invalid slug
returns `{ ok: false, reason }` without calling the component.

### `reserve`

```ts
reserve(ctx, slug: string, resourceRef: string, scope?: string): Promise<SlugWriteResult>
```

Claims `slug` for `resourceRef`. Returns `{ ok: true }`, or `{ ok: false, reason }`
with `SLUG_INVALID`, `SLUG_RESERVED` or `SLUG_TAKEN`. `SLUG_TAKEN` is returned
whenever the slug is held in the scope, also when the same `resourceRef` holds
it. Reserving a slug that was renamed away deletes the redirect that started at
it. Throws `INVALID_ARGUMENT` for `scope: ""` or `resourceRef: ""`, unless the
slug already failed the client checks: then it returns `SLUG_INVALID` (or
`SLUG_RESERVED`) without calling the component. One `resourceRef` may hold
several slugs.

### `release`

```ts
release(ctx, slug: string, scope?: string): Promise<null>
```

Deletes the slug row, if any, and every redirect whose target is `slug`, so
`redirectFor` of an older name returns `null` afterwards. Idempotent: releasing
a slug that is not held does nothing. It does not validate the slug and does not
check who holds it. Throws `INVALID_ARGUMENT` for `scope: ""`.

### `rename`

```ts
rename(ctx, fromSlug: string, toSlug: string, scope?: string): Promise<SlugWriteResult>
```

Moves the slug row from `fromSlug` to `toSlug` (same `resourceRef`) and records
a redirect `fromSlug` -> `toSlug`. Only `toSlug` is validated against the
options. Checks, in order:

1. `toSlug` fails the options: `SLUG_INVALID` or `SLUG_RESERVED` (client).
2. `fromSlug === toSlug` after normalization: `SLUG_TAKEN`, before any read.
3. `toSlug` outside the length bounds: `SLUG_INVALID` (component).
4. `fromSlug` not held: `SLUG_NOT_FOUND`.
5. `toSlug` held: `SLUG_TAKEN`.

On success, redirects that pointed at `fromSlug` are repointed to `toSlug`, so a
chain A -> B -> C leaves A -> C and B -> C. At most one redirect row exists per
`(scope, fromSlug)`. A redirect that started at `toSlug` is deleted, so renaming
back (A -> B, then B -> A) leaves only B -> A and no redirect starts at a live
slug. Throws `INVALID_ARGUMENT` for `scope: ""`.

### `resolve`

```ts
resolve(ctx, slug: string, scope?: string): Promise<string | null>
```

The `resourceRef` holding `slug`, or `null`. It does not follow redirects.

### `redirectFor`

```ts
redirectFor(ctx, slug: string, scope?: string): Promise<string | null>
```

When `slug` was renamed away, the live slug it now points to; otherwise `null`.
Chains are collapsed, so the result is the live slug: no second lookup is needed.

### `slugForResource`

```ts
slugForResource(ctx, resourceRef: string, scope?: string): Promise<string | null>
```

The slug held by `resourceRef` in the scope, or `null`. When one resource holds
several slugs it returns one of them.

## Types

### `SlugsComponent`

The type of `components.slugs`: `mutations.reserve`, `mutations.release`,
`mutations.rename`, `queries.resolve`, `queries.redirectFor` and
`queries.slugForResource` as internal function references. `ComponentApi`
matches it.

### `SlugsOptions`

```ts
interface SlugsOptions {
  defaultScope?: string; // default "global"
  foldCase?: boolean; // default true
  minLength?: number; // default 1
  maxLength?: number; // default 256
  pattern?: RegExp; // default: none
  reservedWords?: string[]; // default []
}
```

`new Slugs` throws `INVALID_OPTIONS` unless `defaultScope` is non-empty,
`minLength` and `maxLength` are integers, `minLength >= 0`, and
`maxLength >= max(1, minLength)`. A `pattern` with the `g` or `y` flag is reset
before each test, so the same slug always gets the same verdict.

### `SlugWriteResult`

```ts
interface SlugWriteResult {
  ok: boolean;
  reason?: "SLUG_TAKEN" | "SLUG_NOT_FOUND" | "SLUG_INVALID" | "SLUG_RESERVED";
}
```

`reason` is set when `ok` is `false`.

## React hooks

`@vllnt/convex-slugs/react` wraps `useQuery` from `convex/react`. Each hook
takes the host's own public query reference with args `{ slug, scope? }` (a
query that takes only `{ slug }` also fits; then pass `scope` only if your query
accepts it, because Convex rejects unknown args at runtime) and return type `string | null`,
usually a query that returns `slugs.resolve(...)`. The component's own queries
are internal and cannot be called from a browser. The hooks need a
`ConvexProvider`.

### `useSlugAvailable`

```ts
useSlugAvailable(resolveRef, args: { slug: string; scope?: string }): { available: boolean | undefined; resourceRef: string | null }
```

`available` is `undefined` while loading, `true` when the query returns `null`,
and `false` when it returns a holder. `resourceRef` is the holder, or `null`
when free or loading. This is a hint: it does not check length, `pattern` or
reserved words, and another caller can claim the slug before `reserve` runs.

### `useResolve`

```ts
useResolve(resolveRef, args: { slug: string; scope?: string }): string | null | undefined
```

The query's result: the holding `resourceRef`, `null` when free, or `undefined`
while loading.

## Other entry points

### `convex.config`

The default export of `@vllnt/convex-slugs/convex.config` is the component
definition, named `slugs`. Mount it with `app.use(config)`, or
`app.use(config, { name })` for several isolated mounts.

### `register`

```ts
register<TSchema extends GenericSchema>(t: TestConvex<SchemaDefinition<TSchema, boolean>>, name = "slugs"): void
```

From `@vllnt/convex-slugs/test`. Mounts the component in a `convex-test`
instance under `name` (default `"slugs"`). `t` may be built from the host app's
own schema. Shipped as TypeScript source that uses Vite's `import.meta.glob`, so
run it under Vitest.

### `ComponentApi`

From `@vllnt/convex-slugs/_generated/component`. The Convex-generated type of
the mounted component, the same shape as `SlugsComponent`.

## Reason codes

`reserve` and `rename` return `{ ok: false, reason }` instead of throwing:

| Reason           | When                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `SLUG_INVALID`   | After normalization the slug is empty, outside `minLength`..`maxLength`, or fails `pattern` |
| `SLUG_RESERVED`  | The normalized slug is in the normalized `reservedWords`                                    |
| `SLUG_TAKEN`     | The slug is held in the scope, or `rename` got `fromSlug === toSlug` after normalization    |
| `SLUG_NOT_FOUND` | `rename` got a `fromSlug` that is not held in the scope                                     |

Causes and fixes are in the README's
[Errors and fixes](../README.md#errors-and-fixes) table.

## Errors

Invalid input throws a `ConvexError` whose `data` is `{ code, message }`:

| Code               | Thrown by                                          | When                                                                                                                     |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `INVALID_OPTIONS`  | `new Slugs(...)`                                   | Empty `defaultScope`, or `minLength`/`maxLength` not integers with `minLength >= 0` and `maxLength >= max(1, minLength)` |
| `INVALID_ARGUMENT` | component mutations `reserve`, `release`, `rename` | Empty `scope`, empty `resourceRef` (`reserve`), or `bounds` that are not integers with `minLength <= maxLength`          |

The client always sends integer bounds from its validated options, so through
`Slugs` only an empty `scope` or `resourceRef` raises `INVALID_ARGUMENT`. The
queries do not throw for an empty scope. Arguments of the wrong type are
rejected by Convex argument validation.

## Normalization

Every slug argument goes through `String.prototype.normalize("NFC")`, then
`.trim()`, then `.toLowerCase()` when `foldCase` is `true`. Reserved words are
normalized the same way, so `reservedWords: ["Admin"]` blocks `admin`.

- NFC makes precomposed and combining-character spellings of the same letter
  one slug. It does not apply compatibility folding (NFKC), confusable
  detection or zero-width-character stripping; use `pattern` to restrict the
  alphabet.
- Lengths count UTF-16 code units of the normalized slug (a single emoji such
  as 😀 counts 2; flags and joined emoji count more).
- `toLowerCase()` is not full Unicode case folding: `"STRASSE"` and `"straße"`
  stay different slugs.

## Concurrency

`reserve` and `rename` each run as one Convex mutation, which is serializable.
When several callers claim the same slug at once, exactly one succeeds and the
others receive `SLUG_TAKEN`. Convex indexes are not unique constraints, so
always write through these mutations. Reads use `.first()`, so a duplicate row
created outside them returns one value instead of throwing.
