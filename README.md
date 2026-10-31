<!-- Badges -->

[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-slugs.svg)](https://www.npmjs.com/package/@vllnt/convex-slugs)
[![CI](https://github.com/vllnt/convex-slugs/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-slugs/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-slugs.svg)](./LICENSE)

# @vllnt/convex-slugs

Unique slug and handle registry with rename redirects, as a Convex component.

```ts
const slugs = new Slugs(components.slugs);
await slugs.reserve(ctx, "ada", userId); // { ok: true } | { ok: false, reason }
const ref = await slugs.resolve(ctx, "ada"); // resourceRef | null
```

Reserve a unique string (slug, `@handle`, username) against an opaque
`resourceRef`, enforce uniqueness inside a scope, resolve it back, release it,
and **redirect on rename**. Domain-neutral: article slugs, profile handles,
workspace slugs — any public-URL key.

## Features

- **Atomic uniqueness** per `(scope, slug)` — rides the Convex mutation
  transaction, no double-reserve.
- **Scopes** — global by default, or namespace per tenant / locale / type.
- **Rename + redirects** — renaming records an old → new redirect for link
  preservation.
- **Chain-safe redirects** — chains collapse (A→B→C ⇒ `redirectFor(A) === C`),
  one row per source.
- **Reverse lookup** — find the slug currently held by a `resourceRef`.
- **Case folding + NFC** — case-insensitive (opt-out); NFC unifies canonically
  equivalent Unicode spellings, not all look-alike characters.
- **Configurable input rules** — length bounds, charset `pattern`,
  `reservedWords`; typed rejection reasons.
- **Typed write rejections** — expected conflicts return
  `{ ok: false, reason }`; invalid configuration and Convex/runtime failures can
  still throw.

## Installation

```bash
pnpm add @vllnt/convex-slugs
```

Requires `convex@^1.45.0`; React `>=18` is optional for `./react` only. The
command installs the stable release. Prereleases are published under the
`canary` tag (`@vllnt/convex-slugs@canary`); pin a resolved canary version for
reproducible installs.

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
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return slugs.reserve(ctx, handle, identity.tokenIdentifier);
  },
});

export const lookup = query({
  args: { slug: v.string(), scope: v.optional(v.string()) },
  handler: (ctx, { slug }) => slugs.resolve(ctx, slug, "global"),
});
```

Client defaults: `defaultScope: "global"`, `foldCase: true`, `minLength: 1`,
`maxLength: 256`, `reservedWords: []`; `pattern` is optional. Configure these in
`new Slugs(component, options)`; see [the API reference](docs/API.md).

## API Reference

| Method                                      | Kind     | Result                                                                                        |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `reserve(ctx, slug, resourceRef, scope?)`   | mutation | `{ ok: true }` or `{ ok: false, reason }` (`SLUG_INVALID` \| `SLUG_RESERVED` \| `SLUG_TAKEN`) |
| `release(ctx, slug, scope?)`                | mutation | `null` (idempotent)                                                                           |
| `rename(ctx, fromSlug, toSlug, scope?)`     | mutation | `{ ok }` (`SLUG_INVALID` \| `SLUG_RESERVED` \| `SLUG_NOT_FOUND` \| `SLUG_TAKEN`)              |
| `resolve(ctx, slug, scope?)`                | query    | `resourceRef \| null`                                                                         |
| `redirectFor(ctx, slug, scope?)`            | query    | `toSlug \| null`                                                                              |
| `slugForResource(ctx, resourceRef, scope?)` | query    | `slug \| null`                                                                                |

Full reference: [docs/API.md](docs/API.md).

## React

Optional, tree-shakeable hooks from `@vllnt/convex-slugs/react` — thin wrappers
over `useQuery`; `react` is an optional peer dep. Each takes the host's
re-exported `resolve` query reference.

```tsx
import { useSlugAvailable } from "@vllnt/convex-slugs/react";
import { api } from "../convex/_generated/api";

// `available` is undefined while loading, true when free, false when held.
const { available, resourceRef } = useSlugAvailable(api.handles.lookup, {
  slug,
});
```

| Hook                                             | Returns                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `useSlugAvailable(resolveRef, { slug, scope? })` | `{ available, resourceRef }` — `available` `undefined` while loading, `true` free, `false` held |
| `useResolve(resolveRef, { slug, scope? })`       | `resourceRef \| null \| undefined` (`undefined` while loading)                                  |

Availability is a lookup hint, not a reservation or validation of length,
pattern, or reserved words. A concurrent claim can win; always check `reserve`'s
result. The example intentionally exposes public handles in the global scope
only.

## Security

- **Auth-agnostic** — the host authenticates the caller, decides who may claim a
  handle, and passes an opaque `resourceRef`.
- **Management authorization** — before `release` or `rename`, verify ownership
  in the host. Authentication alone does not authorize changing another
  subject's slug.
- **Opaque refs only** — `resourceRef` and `scope` are arbitrary strings; tables
  are sandboxed (reached only via the client).
- **Boundary re-guard** — the component re-guards length at the trust boundary
  even if a caller bypasses the client.
- **Uniqueness under concurrency** — each `reserve`/`rename` is one Convex
  mutation (serializable): of simultaneous claims on a slug, one succeeds and
  the rest get `SLUG_TAKEN`.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test`
(`@edge-runtime/vm`), not mocks.

### Testing your app

`@vllnt/convex-slugs/test` exports `register(t, name = "slugs")` to mount the
component in a `convex-test` instance. It needs `convex-test` and `vitest` (with
Vite's `import.meta.glob`) in the consuming app:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register } from "@vllnt/convex-slugs/test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob("./**/*.ts"));
register(t);
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet —
[vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
