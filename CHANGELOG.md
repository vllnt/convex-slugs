# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.

### Fixed

- `release` now deletes all `redirects` rows whose `toSlug` equals the released slug,
  so `redirectFor(old)` returns `null` instead of a dead target after release. Uses the
  existing `by_scope_to` index.
- `rename` gains an explicit self-rename guard (`fromSlug === toSlug` → `SLUG_TAKEN`)
  at the top of the handler, before any DB read.
- `normalizeSlug` now applies `String.prototype.normalize("NFC")` before trimming, so
  visually-identical slugs with different Unicode compositions collide as expected.
- `redirectFor` query: removed a dead `.order("desc")` call (at most one row per
  `(scope, fromSlug)` — the call was misleading with no effect).

## [0.1.0] - 2026-06-12

### Added

- First release of `@vllnt/convex-slugs`.

### Hardened (in-place review fixes, 0.1.0)

- Configurable input rules on the client: `minLength` (1), `maxLength` (256),
  `pattern?` (charset), and `reservedWords` ([]); empty/whitespace slugs are
  rejected. The component re-guards length at the trust boundary.
- Typed rejection reasons as a string-literal union — `SLUG_TAKEN`,
  `SLUG_NOT_FOUND`, `SLUG_INVALID`, `SLUG_RESERVED` — on both the Convex
  validator and the client `SlugWriteResult`.
- Redirect chains collapse: `rename` repoints existing redirects to the live
  slug (A→B→C ⇒ `redirectFor(A) === C`), keeping one row per `(scope, fromSlug)`
  via a new `by_scope_to` index. Reserving a renamed-away slug clears its
  dangling redirect.
- Registry reads use `.first()` instead of `.unique()` so a stray duplicate row
  degrades to a value rather than throwing.
