// Success and failure paths of check-documentation.mjs.
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkApi,
  checkRelatedPackages,
  checkRetiredDomain,
  checkSources,
  sections,
} from "./check-documentation.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "slugs-docs-contract-"));
after(() => {
  rmSync(scratch, { force: true, recursive: true });
});

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

/**
 * A copy of this repository's shipped docs with `edit` applied to one file.
 * @param {string} file @param {(text: string) => string} edit
 */
function docsWith(file, edit) {
  const copy = mkdtempSync(join(scratch, "copy-"));
  ["README.md", "llms.txt", "CHANGELOG.md", "LICENSE", "package.json"].forEach(
    (name) => {
      cpSync(join(root, name), join(copy, name));
    },
  );
  ["docs", "src"].forEach((name) => {
    cpSync(join(root, name), join(copy, name), { recursive: true });
  });
  const target = join(copy, file);
  const original = readFileSync(target, "utf8");
  const edited = edit(original);
  assert.notEqual(edited, original, `the edit did not change ${file}`);
  writeFileSync(target, edited);
  return copy;
}

/** @param {string} file @param {(text: string) => string} edit @param {RegExp} message */
const failsWith = (file, edit, message) => {
  assert.throws(() => checkSources(docsWith(file, edit)), message);
};

test("this repository's docs pass", () => {
  checkSources(root);
});

test("a missing section fails", () => {
  failsWith(
    "README.md",
    (text) => text.replace("\n## Common tasks\n", "\nCommon tasks\n"),
    /README has no section Common tasks/u,
  );
});

test("sections in the wrong order fail", () => {
  failsWith(
    "README.md",
    (text) =>
      text
        .replace("\n## Testing\n", "\n## SWAP\n")
        .replace("\n## Security\n", "\n## Testing\n")
        .replace("\n## SWAP\n", "\n## Security\n"),
    /sections must be SECTIONS, in order/u,
  );
});

test("a code block without a language fails", () => {
  failsWith(
    "README.md",
    (text) => text.replace("```bash\n", "```\n"),
    /README\.md:\d+ has no language/u,
  );
});

test("an untagged block in docs/API.md fails too", () => {
  failsWith(
    "docs/API.md",
    (text) => text.replace("```ts\n", "```\n"),
    /docs\/API\.md:\d+ has no language/u,
  );
});

test("a README example with a gap marker fails", () => {
  failsWith(
    "README.md",
    (text) =>
      text.replace(
        "const app = defineApp();",
        "const app = defineApp();\n// …",
      ),
    /has a \.\.\. gap/u,
  );
});

test("a different footer fails", () => {
  failsWith(
    "README.md",
    (text) => text.replace("Built by [bntvllnt]", "Made by [bntvllnt]"),
    /README ends with the vllnt footer/u,
  );
});

test("a changed Links block fails", () => {
  failsWith(
    "README.md",
    (text) =>
      text.replace("- Sponsor: [GitHub Sponsors]", "- Sponsor: [Sponsors]"),
    /README Links: the shared block/u,
  );
});

test("llms.txt without the Ecosystem block at the end fails", () => {
  failsWith(
    "llms.txt",
    (text) => `${text}\n## Extra\n\n- [More](https://oss.vllnt.com)\n`,
    /llms\.txt: ends with Ecosystem/u,
  );
});

test("an install command below line 40 fails", () => {
  failsWith(
    "README.md",
    (text) =>
      text.replace(
        "## Install\n",
        `## Install\n${"\nFiller line.\n".repeat(20)}`,
      ),
    /install near the top/u,
  );
});

test("a link to a missing anchor fails", () => {
  failsWith(
    "README.md",
    (text) =>
      text.replace("(docs/API.md#reserve)", "(docs/API.md#reserve-a-slug)"),
    /docs\/API\.md#reserve-a-slug has no such anchor/u,
  );
});

test("a reason code missing from the errors table fails", () => {
  failsWith(
    "README.md",
    (text) => text.replace("| `SLUG_NOT_FOUND` |", "| `SLUG_MISSING` |"),
    /Errors and fixes lacks SLUG_NOT_FOUND/u,
  );
});

test("a description that differs from package.json fails", () => {
  failsWith(
    "package.json",
    (text) =>
      text.replace('"description": "Convex', '"description": "A Convex'),
    /README intro: package\.json description/u,
  );
});

/**
 * An installed fixture package whose main entry exports `documented` and
 * `extra`; `extraDoc` is the TSDoc written above `extra`.
 * @param {string} extraDoc
 */
function fixturePackage(extraDoc) {
  const consumer = mkdtempSync(join(scratch, "consumer-"));
  const installed = join(consumer, "node_modules", "@vllnt", "example");
  mkdirSync(installed, { recursive: true });
  const manifest = {
    exports: { ".": { types: "./index.d.ts" } },
    name: "@vllnt/example",
  };
  writeFileSync(join(installed, "package.json"), JSON.stringify(manifest));
  writeFileSync(
    join(installed, "index.d.ts"),
    [
      "/**\n * Documented.\n * @see https://oss.vllnt.com/packages/example\n */",
      "export declare function documented(): void;",
      extraDoc,
      "export declare function extra(): void;",
    ].join("\n"),
  );
  return { consumer, manifest };
}

const bothDocumented = {
  headings: new Set(["documented", "extra"]),
  table:
    "| [`documented`](docs/API.md#documented) |\n| [`extra`](docs/API.md#extra) |",
};

test("every export documented passes", () => {
  const { consumer, manifest } = fixturePackage("/** Extra. */");
  checkApi(consumer, manifest, bothDocumented);
});

test("an export missing from the README API table fails", () => {
  const { consumer, manifest } = fixturePackage("/** Extra. */");
  assert.throws(() => {
    checkApi(consumer, manifest, {
      headings: bothDocumented.headings,
      table: "| [`documented`](docs/API.md#documented) |",
    });
  }, /README API table lacks extra/u);
});

test("an export without a docs/API.md heading fails", () => {
  const { consumer, manifest } = fixturePackage("/** Extra. */");
  assert.throws(() => {
    checkApi(consumer, manifest, {
      headings: new Set(["documented"]),
      table: bothDocumented.table,
    });
  }, /docs\/API\.md lacks a extra heading/u);
});

test("an export without a TSDoc summary fails", () => {
  const { consumer, manifest } = fixturePackage("");
  assert.throws(() => {
    checkApi(consumer, manifest, bothDocumented);
  }, /extra has no TSDoc summary/u);
});

test("the retired vllnt domain fails", () => {
  const file = join(mkdtempSync(join(scratch, "domain-")), "README.md");
  writeFileSync(file, `See https://${["vllnt", "ai"].join(".")}/docs.\n`);
  assert.throws(() => {
    checkRetiredDomain([file]);
  }, /mentions the retired vllnt domain/u);
});
