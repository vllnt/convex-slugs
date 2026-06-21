<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-slugs

`@vllnt/convex-slugs` is a Convex component: unique slug and handle registry with rename redirects.
It follows the vllnt Component Standard (see the `convex-components` hub
`.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants + normalizeSlug (pure)
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Slugs client class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
├── react/
│   └── index.tsx          # optional useSlugAvailable + useResolve hooks
└── component/
    ├── schema.ts           # sandboxed tables: slugs + redirects
    ├── convex.config.ts    # defineComponent("slugs")
    ├── mutations.ts        # reserve, release, rename
    ├── queries.ts          # resolve, redirectFor, slugForResource
    └── validators.ts       # shared validators
```

## Ownership boundary

| Concern | Owner |
|---------|-------|
| Uniqueness per `(scope, slug)` | **Component** — enforced in mutation transaction |
| Redirect chain (old → new on rename) | **Component** — `redirects` table, chains collapsed |
| Unicode NFC normalization + case-folding | **Component** (`shared.ts` `normalizeSlug`) |
| `resourceRef` meaning, shape, source | **Host** — opaque string; component never inspects it |
| Auth and authorization | **Host** — component is auth-agnostic |
| Scoping strategy (per-tenant, per-type, etc.) | **Host** — passes opaque `scope` string |
| Slug configuration (length, charset, reserved words) | **Host** — passed as `SlugsOptions` at construction |

## Key design decisions

- **Unique-per-`(scope, slug)` registry.** The `slugs` table has a unique index on `(scope, slug)`;
  Convex's transactional mutations prevent double-reserve without application-level locking.
- **Rename records a redirect and collapses chains.** `rename(A→B)` then `rename(B→C)` rewrites the
  A→B redirect to A→C so `redirectFor(A)` always returns the live slug in one row — no
  multi-hop traversal, at most one redirect row per `(scope, fromSlug)`.
- **`release` deletes inbound redirects.** Releasing a slug removes all `redirects` rows whose
  `toSlug` equals the released slug, preventing `redirectFor` from pointing at a dead target.
- **NFC normalization prevents homoglyph collisions.** `normalizeSlug` applies
  `String.prototype.normalize("NFC")` before trimming and case-folding; visually-identical slugs
  with different Unicode compositions (precomposed vs. combining-character forms) collide as
  expected.
- **Explicit self-rename guard.** `rename(fromSlug, toSlug)` where `fromSlug === toSlug` is
  rejected with `SLUG_TAKEN` before any DB read — avoids a spurious `SLUG_NOT_FOUND` path.
- **Host owns `resourceRef`.** It is stored and returned as an opaque string; the component never
  de-references, validates, or FK-links it.

## Docs sync

| File | Updated when |
|------|-------------|
| `README.md` | API shape, features, install instructions, or peer dep range changes |
| `docs/API.md` | Any public method signature, return shape, or validation reason changes |
| `llms.txt` | `convex` peer dep range changes; new `## Optional` entries |
| `CHANGELOG.md` | Every release |

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host-supplied validator keyed by an opaque ref — never `v.any()` dumps.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.
