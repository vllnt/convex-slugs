# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Fixed

- `rename` no longer leaves a self-redirect when a slug is renamed back to an
  earlier name (A→B, then B→A left `redirectFor(A) === A` on a live slug). A
  redirect starting at the new live name is now removed.
- Reserved words are normalized like slugs, so `reservedWords: ["Admin"]` blocks
  `admin` (previously never matched when `foldCase` was on).
- A `pattern` with the `g` or `y` flag gives the same verdict on every call
  instead of alternating.
- `@vllnt/convex-slugs/test` type-checks for consumers under `nodenext` and
  `bundler` resolution (`vite/client` reference, `.js` suffixes on relative
  imports).
- Test files are no longer included in the published package.
- `register` from `@vllnt/convex-slugs/test` accepts a `convex-test` instance
  built from the host app's schema, as the README shows; it used to require the
  component's own schema type.

### Added

- Invalid input is rejected with a `ConvexError`: `INVALID_OPTIONS` from
  `new Slugs(...)` (empty `defaultScope`, `minLength`/`maxLength` that are not
  integers, or inverted), and `INVALID_ARGUMENT` from component mutations (empty
  `scope`/`resourceRef`, invalid `bounds`). A `NaN` `maxLength` used to disable
  the length cap.
- The npm package ships `docs/API.md`, `CHANGELOG.md` and `llms.txt`, so the
  docs in `node_modules/@vllnt/convex-slugs/` match the installed version.
  `llms.txt` links to the shipped files with relative paths. `docs/API.md` now
  lists every entry point, the React hooks and the `register` test helper.

### Changed

- Docs: README install command targets the stable release, "Testing your app",
  error table, concurrency and normalization limits.
- Release flow: npm trusted publishing with provenance; `@latest` only from a
  `vX.Y.Z` tag on `main`. Pinned CI actions, pnpm 10 with a release-age gate,
  low-memory dev defaults.
- Release flow: every push to `main` that changes the package or its shipped
  docs publishes a `canary`; `pnpm test:package` in CI fails when a required
  file is missing from the packed tarball.
- `package.json` `homepage` points to
  https://oss.vllnt.com/packages/convex-slugs.

## [0.1.0] - 2026-09-01

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

### Changed

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and
  expose a dedicated codegen script.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.

### Fixed

- `release` deletes all `redirects` rows whose `toSlug` equals the released
  slug, so `redirectFor(old)` returns `null` instead of a dead target after
  release.
- `rename` rejects a self-rename (`fromSlug === toSlug`) with `SLUG_TAKEN`
  before any DB read.
- `normalizeSlug` applies Unicode NFC before trimming, so visually-identical
  slugs with different compositions collide as expected.
- `redirectFor` no longer carries a dead `.order("desc")` call.
