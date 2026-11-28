# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-28

### Breaking

Input that 0.1.0 accepted is now rejected. What to do:

- `new Slugs(...)` throws a `ConvexError` with code `INVALID_OPTIONS` for an
  empty `defaultScope`, a `minLength` or `maxLength` that is not an integer
  (for example `1.5` or `NaN`), a negative `minLength`, `minLength > maxLength`,
  or `maxLength < 1`. A `NaN` `maxLength` used to disable the length cap. Fix
  the options.
- The component mutations `reserve`, `release` and `rename` throw a
  `ConvexError` with code `INVALID_ARGUMENT` for an empty `scope`, an empty
  `resourceRef` (`reserve`), or `bounds` that are not integers or have
  `minLength > maxLength`. Rows that 0.1.0 stored under scope `""` can no longer
  be released or renamed. Pass a non-empty `scope` (or omit it for
  `defaultScope`) and a non-empty `resourceRef`.
- `reserve` and `rename` cap what they write at 1024 UTF-16 code units
  (`string.length`), whatever `maxLength` or `bounds` say. A longer slug or
  `toSlug` returns `{ ok: false, reason: "SLUG_INVALID" }`; a longer `scope`
  (`reserve`, `rename`) or `resourceRef` (`reserve`) throws `INVALID_ARGUMENT`.
  Shorten such values; `new Slugs` still accepts a `maxLength` over 1024, but
  the component rejects the longer slugs. Rows stored over the cap before 0.2.0
  stay readable, and `release` still removes them. Updating such a row: `rename`
  from an over-cap slug to a shorter one works; `reserve` or `rename` onto an
  over-cap slug returns `SLUG_INVALID` and leaves the row; `reserve` and
  `rename` in an over-cap scope throw `INVALID_ARGUMENT`; a row with an over-cap
  `resourceRef` keeps it when renamed.
- Reserved words are normalized like slugs, so `reservedWords: ["Admin"]` now
  blocks `admin` with `SLUG_RESERVED` (0.1.0 never matched it while `foldCase`
  was on). Remove a word from `reservedWords` if it must stay claimable.

### Fixed

- `rename` no longer leaves a self-redirect when a slug is renamed back to an
  earlier name (A→B, then B→A left `redirectFor(A) === A` on a live slug). A
  redirect starting at the new live name is now removed.
- A `pattern` with the `g` or `y` flag gives the same verdict on every call
  instead of alternating.
- `@vllnt/convex-slugs/test` type-checks for consumers under `nodenext` and
  `bundler` resolution (`vite/client` reference, `.js` suffixes on relative
  imports).
- `register` from `@vllnt/convex-slugs/test` accepts a `convex-test` instance
  built from the host app's schema, as the README shows; it used to require the
  component's own schema type.
- Test files are no longer included in the published package.

### Added

- The npm package ships `docs/API.md`, `CHANGELOG.md` and `llms.txt`, so the
  docs in `node_modules/@vllnt/convex-slugs/` match the installed version.
  `llms.txt` links to the shipped files with relative paths. `docs/API.md` lists
  every entry point, the React hooks and the `register` test helper.

### Changed

- `engines.node` is now `>=20` (was `>=18`): the lowest supported `convex`,
  1.45, needs Node.js 20. Use Node.js 20 or later. The peer range stays
  `convex@^1.45.0`.
- Releases are published from CI with npm provenance. `@latest` comes only from
  a `vX.Y.Z` tag on `main`, and every push to `main` publishes a `canary` built
  from that commit.
- Docs: README rewritten in the shared @vllnt section order (When to use, Quick
  start, API table, Common tasks, Errors and fixes, Limits and gotchas,
  Compatibility, Testing, Security, Links), with the install command for the
  stable release, every reason and error code, and the concurrency and
  normalization limits; "Related packages" lists none, and the hint to use
  `@vllnt/convex-tokens` for secret keys is in the intro. `docs/API.md` has one
  heading per export and method; `llms.txt` has When to use, an errors link
  and the Ecosystem block last; TSDoc on every public export.
- `package.json`: `description` is now "Convex component for unique slugs,
  handles and usernames per scope, with rename redirects, a TypeScript client
  and React hooks.", `keywords` list 11 search terms, and `homepage` points to
  https://oss.vllnt.com/packages/convex-slugs.
- Internal: CI, release and docs checks (packed-package test against convex
  1.45.0 and React 18, tarball contents, docs contract), a 7-day release-age
  gate, pnpm 10 through Corepack, no version-update bot, and more tests.

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
