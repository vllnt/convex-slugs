// Success and failure paths of check-documentation.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRelatedPackages, sections } from "./check-documentation.mjs";

/** @param {string} body */
const readme = (body) =>
  `# @vllnt/example\n\nIntro.\n\n## Related packages\n\n${body}\n\n## Contributing\n\nSee CONTRIBUTING.md.\n`;
const metadata = { devDependencies: { "@vllnt/typescript": "3.0.0" } };

test("an entry without a code relation and with an npm link fails", () => {
  const old = readme(
    "- [`@vllnt/convex-tokens`](https://www.npmjs.com/package/@vllnt/convex-tokens) —\n  use it when the key must stay secret.",
  );
  assert.throws(() => {
    checkRelatedPackages(old, metadata, ["export {};"]);
  }, /@vllnt\/convex-tokens has no dependency or import/u);
});

test("'None.' passes", () => {
  const none = readme(
    "None. This package has no dependency, shared test or example with another\npackage.",
  );
  checkRelatedPackages(none, metadata, []);
});

test("a dependency-backed entry linking its package page passes", () => {
  const entry = readme(
    "- [`@vllnt/convex-tokens`](https://oss.vllnt.com/packages/convex-tokens) — signs the share links this package resolves.",
  );
  checkRelatedPackages(
    entry,
    { dependencies: { "@vllnt/convex-tokens": "^1.0.0" } },
    [],
  );
});

test("an entry imported by the example passes", () => {
  const entry = readme(
    "- [`@vllnt/convex-tokens`](https://oss.vllnt.com/packages/convex-tokens) — the example uses both.",
  );
  checkRelatedPackages(entry, metadata, [
    'import { Tokens } from "@vllnt/convex-tokens/client";',
  ]);
});

test("a related package must link its package page", () => {
  const entry = readme(
    "- [`@vllnt/convex-tokens`](https://www.npmjs.com/package/@vllnt/convex-tokens) — real dependency.",
  );
  assert.throws(() => {
    checkRelatedPackages(
      entry,
      { peerDependencies: { "@vllnt/convex-tokens": "^1.0.0" } },
      [],
    );
  }, /link @vllnt\/convex-tokens to https:\/\/oss\.vllnt\.com\/packages\/convex-tokens/u);
});

test("a README without the section fails", () => {
  assert.throws(() => {
    checkRelatedPackages("# x\n\n## Contributing\n", metadata, []);
  }, /no section Related packages/u);
});

test("an empty code block does not hide the next heading", () => {
  const text = "# x\n\n```\n```\n## Related packages\n\nNone.\n";
  assert.deepEqual(
    sections(text).map((part) => part.name),
    ["Related packages"],
  );
  checkRelatedPackages(text, metadata, []);
});

test("a code block holding one empty line ends at its fence", () => {
  const text = "# x\n\n```\n\n```\n## Related packages\n\nNone.\n";
  assert.deepEqual(
    sections(text).map((part) => part.name),
    ["Related packages"],
  );
});

test("a heading inside a code block is not a section", () => {
  const text = "# x\n\n```md\n## Related packages\n```\n";
  assert.throws(() => {
    checkRelatedPackages(text, metadata, []);
  }, /no section Related packages/u);
});
