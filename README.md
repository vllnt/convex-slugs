<!-- Badges -->
[![npm](https://img.shields.io/npm/v/@vllnt/convex-slugs.svg)](https://www.npmjs.com/package/@vllnt/convex-slugs)
[![CI](https://github.com/vllnt/convex-slugs/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-slugs/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-slugs.svg)](./LICENSE)

# @vllnt/convex-slugs

Unique slug and handle registry with rename redirects, as a Convex component.

Reserve a unique string (slug, `@handle`, username) against an opaque
`resourceRef`, enforce uniqueness inside a scope, resolve it back, release it,
and **redirect on rename** (old → new). Domain-neutral: article/page slugs,
profile handles, workspace slugs — any public-URL key. The host owns the
resource and its meaning; this component owns only the uniqueness + redirect
state.

## Features

- **Atomic uniqueness** per `(scope, slug)` — rides the Convex mutation transaction, no double-reserve.
- **Scopes** — global by default, or namespace per tenant / locale / type.
- **Rename + redirects** — renaming records an old → new redirect for link preservation.
- **Reverse lookup** — find the slug currently held by a `resourceRef`.
- **Case folding** — case-insensitive handles by default; opt out per client.
- **Input rules** — configurable length bounds, charset `pattern`, and `reservedWords`; typed rejection reasons.
- **Chain-safe redirects** — renaming repoints existing redirects so `redirectFor` always lands on the live slug, one row per source.
- **Degrades, never throws** — reads use `.first()`, so a stray duplicate row returns a value instead of erroring.
- **Opaque refs** — `resourceRef` is an arbitrary host string; the component never inspects it.

## Architecture

```
src/
├── shared.ts              # constants + normalizeSlug (pure)
├── test.ts                # convex-test register() helper
├── client/                # Slugs class (the public API)
└── component/             # schema (slugs + redirects) + mutations + queries
```

Sandboxed tables: `slugs {scope, slug, resourceRef}` (unique by `(scope, slug)`)
and `redirects {scope, fromSlug, toSlug}`.

## Installation

```bash
pnpm add @vllnt/convex-slugs
```

Peer dependency: `convex@^1.36.1`.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import slugs from "@vllnt/convex-slugs/convex.config";

const app = defineApp();
app.use(slugs);
export default app;
```

```ts
// convex/handles.ts — host owns auth; pass an opaque resourceRef in.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Slugs } from "@vllnt/convex-slugs";

const slugs = new Slugs(components.slugs);

export const claim = mutation({
  args: { handle: v.string(), userId: v.string() },
  handler: (ctx, { handle, userId }) => slugs.reserve(ctx, handle, userId),
});

export const lookup = query({
  args: { handle: v.string() },
  handler: (ctx, { handle }) => slugs.resolve(ctx, handle),
});
```

## API Reference

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `reserve(ctx, slug, resourceRef, scope?)` | mutation | `{ ok: true }` or `{ ok: false, reason }` (`SLUG_INVALID` \| `SLUG_RESERVED` \| `SLUG_TAKEN`) |
| `release(ctx, slug, scope?)` | mutation | `null` (idempotent) |
| `rename(ctx, fromSlug, toSlug, scope?)` | mutation | `{ ok }` (`SLUG_INVALID` \| `SLUG_NOT_FOUND` \| `SLUG_TAKEN`) |
| `resolve(ctx, slug, scope?)` | query | `resourceRef \| null` |
| `redirectFor(ctx, slug, scope?)` | query | `toSlug \| null` |
| `slugForResource(ctx, resourceRef, scope?)` | query | `slug \| null` |

`reason` is a typed string-literal union: `SLUG_TAKEN | SLUG_NOT_FOUND | SLUG_INVALID | SLUG_RESERVED`.

Client options: `new Slugs(component, { defaultScope = "global", foldCase = true, minLength = 1, maxLength = 256, pattern?, reservedWords = [] })`.

A slug that is empty/whitespace, outside `minLength`..`maxLength`, or fails `pattern`
is rejected `SLUG_INVALID`; one in `reservedWords` is rejected `SLUG_RESERVED`.
Validation runs in the client against the resolved options, and the component
re-guards length at the trust boundary. Renames repoint redirect chains so
`redirectFor` always lands on the live slug (A→B→C ⇒ `redirectFor(A) === C`), and
reads use `.first()` so a stray duplicate row degrades rather than throwing.

## React

Optional, tree-shakeable React hooks ship from `@vllnt/convex-slugs/react`. They
are thin wrappers over `useQuery` from `convex/react`: a backend-only consumer
pulls none of this code, and `react` is an optional peer dependency.

Each hook takes the **host's own re-exported** `resolve` query reference — the
component never imports your `api`. Re-export the client's `resolve` as a public
query, then pass that reference in:

```ts
// convex/handles.ts — expose resolve as a public query for the client.
export const resolveHandle = query({
  args: { slug: v.string(), scope: v.optional(v.string()) },
  handler: (ctx, { slug, scope }) => slugs.resolve(ctx, slug, scope),
});
```

```tsx
import { useSlugAvailable, useResolve } from "@vllnt/convex-slugs/react";
import { api } from "../convex/_generated/api";

function HandleField({ slug }: { slug: string }) {
  // Live "is this handle free?" UX. `available` is `undefined` while loading.
  const { available, resourceRef } = useSlugAvailable(api.handles.resolveHandle, {
    slug,
  });
  if (available === undefined) return <span>Checking…</span>;
  return <span>{available ? "Available" : `Taken by ${resourceRef}`}</span>;
}
```

| Hook | Returns |
|------|---------|
| `useSlugAvailable(resolveRef, { slug, scope? })` | `{ available, resourceRef }` — `available` is `undefined` while loading, `true` when free, `false` when held |
| `useResolve(resolveRef, { slug, scope? })` | `resourceRef \| null \| undefined` (`undefined` while loading) |

The `./react` layer is verified by the consuming app's E2E, not this component's
unit-coverage gate.

## Security Model

The component is **auth-agnostic**: it never authenticates or authorizes. The
host resolves identity, decides whether a caller may claim a handle, and passes
an opaque `resourceRef`. Component tables are sandboxed — the host reaches them
only through the exported functions. `resourceRef` and `scope` are opaque
strings; the component never inspects or de-references them.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
