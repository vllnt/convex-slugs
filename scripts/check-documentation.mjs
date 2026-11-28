// Agent-first documentation contract shared by every @vllnt package.
// Run as a script it checks this repository's docs (no build needed);
// test-package.mjs runs `checkDocumentation` on the installed tarball, which
// adds the export checks against the built types.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import ts from "typescript";

/** README `##` sections, in this order, in every @vllnt package. */
export const SECTIONS = [
  "For coding agents",
  "When to use",
  "Install",
  "Quick start",
  "API",
  "Common tasks",
  "Errors and fixes",
  "Limits and gotchas",
  "Compatibility",
  "Testing",
  "Security",
  "Related packages",
  "Contributing",
  "Links",
  "License",
];
const FIRST_LINES = 40;
const OSS = "https://oss.vllnt.com";
/** Folders whose sources count as code that uses another package. */
const CODE_FOLDERS = ["src", "example"];

/**
 * @typedef {{ code: string, end: number, lang: string, line: number }} Block
 * @typedef {{ lang: string, line: number, lines: string[] }} OpenBlock
 * @typedef {{ body: string, line: number, name: string }} Section
 * @typedef {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} Metadata
 * @typedef {{ name: string, target: ts.Symbol }} Export
 * @typedef {{ checker: ts.TypeChecker, entry: string, symbols: Export[] }} Entry
 * @typedef {{ headings: Set<string>, table: string }} Documented
 * @typedef {string | { url?: unknown }} Repository
 * @typedef {{ description?: unknown, exports: Record<string, unknown>, keywords?: unknown, name: string, repository?: Repository }} Manifest
 * @typedef {{ code: string, path: string }} Example
 */

/** @param {string} name package name without the scope */
export const footer = (name) =>
  `---\n\nPart of [vllnt open source](${OSS}) · [Package page](${OSS}/packages/${name}) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)\n`;

/** @param {string} name package name without the scope */
export const ecosystem = (name) =>
  [
    "## Ecosystem\n",
    `- [Package page](${OSS}/packages/${name})`,
    `- [Release feed](${OSS}/packages/${name}/rss.xml)`,
    `- [All @vllnt packages](${OSS}/llms.txt)`,
    "- [Search vllnt packages and docs](https://index.vllnt.com)",
    "- [vllnt](https://vllnt.com/llms.txt)",
    "- [Author](https://bntvllnt.com)\n",
  ].join("\n");

/**
 * Body of the README `## Links` section.
 * @param {string} name package name without the scope
 * @param {string} repository GitHub repository URL without `.git`
 */
export const links = (name, repository) =>
  [
    `- Docs and changelog: [oss.vllnt.com/packages/${name}](${OSS}/packages/${name}) · [release feed](${OSS}/packages/${name}/rss.xml)`,
    `- All @vllnt packages: [oss.vllnt.com](${OSS}) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)`,
    `- Source and issues: [GitHub](${repository}) · [issues](${repository}/issues) · [npm](https://www.npmjs.com/package/@vllnt/${name})`,
    "- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)",
    "- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)",
    "- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)",
  ].join("\n");

/** GitHub heading anchor. @param {string} heading */
export const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .replaceAll(/\s/gu, "-");

/** Fenced code blocks with 1-based opening and closing fence lines. @param {string} text */
export function codeBlocks(text) {
  /** @type {{ blocks: Block[], open: OpenBlock | undefined }} */
  const start = { blocks: [], open: undefined };
  const state = text.split("\n").reduce((current, line, index) => {
    if (!line.startsWith("```")) {
      current.open?.lines.push(line);
      return current;
    }
    if (current.open === undefined) {
      const open = { lang: line.slice(3).trim(), line: index + 1, lines: [] };
      return { ...current, open };
    }
    const { lang, line: at, lines } = current.open;
    const block = { code: lines.join("\n"), end: index + 1, lang, line: at };
    return { blocks: [...current.blocks, block], open: undefined };
  }, start);
  assert.equal(state.open, undefined, "unclosed code block");
  return state.blocks;
}

/** Lines outside code blocks with 1-based line numbers. @param {string} text */
function linesOutsideCode(text) {
  const inCode = new Set(
    codeBlocks(text).flatMap(({ end, line }) =>
      Array.from({ length: end - line + 1 }, (_, offset) => line + offset),
    ),
  );
  return text
    .split("\n")
    .map((content, index) => ({ content, line: index + 1 }))
    .filter(({ line }) => !inCode.has(line));
}

/** Heading anchors, skipping `#` lines in code blocks. @param {string} text @returns {Set<string>} */
function anchors(text) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  const headings = linesOutsideCode(text).flatMap(
    ({ content }) => /^#{1,6}\s+(.+)$/u.exec(content)?.slice(1) ?? [],
  );
  return new Set(
    headings.map((heading) => {
      const base = slug(heading);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}-${String(count)}`;
    }),
  );
}

/** `##` sections outside code blocks. @param {string} text @returns {Section[]} */
export function sections(text) {
  const lines = text.split("\n");
  const heads = linesOutsideCode(text).filter(({ content }) =>
    content.startsWith("## "),
  );
  return heads.map((head, index) => ({
    body: lines
      .slice(head.line, (heads[index + 1]?.line ?? lines.length + 1) - 1)
      .join("\n"),
    line: head.line,
    name: head.content.slice(3).trim(),
  }));
}

/** @param {string} directory */
const filesUnder = (directory) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

/**
 * Source texts under `src/` and `example/`, without Convex codegen output.
 * @param {string} root repository root
 */
export const codeSources = (root) =>
  CODE_FOLDERS.flatMap((folder) => filesUnder(join(root, folder)))
    .filter((file) => /\.[cm]?[jt]sx?$/u.test(file))
    .filter((file) => !file.split(/[/\\]/u).includes("_generated"))
    .map((file) => readFileSync(file, "utf8"));

/** @param {string} source @param {string} name full package name */
const imports = (source, name) =>
  new RegExp(
    String.raw`(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']${name.replaceAll("/", String.raw`\/`)}(?:\/[^"']*)?["']`,
    "u",
  ).test(source);

/**
 * Every `@vllnt/<x>` linked under "Related packages" is a real code relation
 * (a package.json dependency or an import in `src/` or `example/`) and links
 * its package page `https://oss.vllnt.com/packages/<x>`.
 * @param {string} readme README text
 * @param {Metadata} metadata package.json contents
 * @param {string[]} sources texts of the package's code (see `codeSources`)
 */
export function checkRelatedPackages(readme, metadata, sources) {
  const related = sections(readme).find(
    (part) => part.name === "Related packages",
  );
  assert.ok(related, "README has no section Related packages");
  const declared = new Set(
    [
      metadata.dependencies,
      metadata.peerDependencies,
      metadata.devDependencies,
    ].flatMap((group) => Object.keys(group ?? {})),
  );
  const found = related.body.matchAll(/\[`?@vllnt\/([\w-]+)`?\]\(([^)]+)\)/gu);
  [...found].forEach(([, other = "", url]) => {
    const name = `@vllnt/${other}`;
    const used =
      declared.has(name) || sources.some((source) => imports(source, name));
    assert.ok(
      used,
      `Related packages: ${name} has no dependency or import in src/ or example/; list only packages this one works with in code`,
    );
    const page = `${OSS}/packages/${other}`;
    assert.equal(url, page, `Related packages: link ${name} to ${page}`);
  });
}

/** @param {Section[]} parts @param {string} name */
function section(parts, name) {
  const found = parts.find((part) => part.name === name);
  assert.ok(found, `README has no section ${name}`);
  return found;
}

/**
 * Title, fixed sections in order, no empty section, short agent note.
 * @param {string} readme @param {string} packageName
 */
export function checkStructure(readme, packageName) {
  assert.ok(
    readme.startsWith(`# ${packageName}\n\n`),
    "README starts with # <package name> and one sentence",
  );
  const intro = readme.split("\n\n")[1] ?? "";
  const stops = intro.match(/[!.?](?=\s|$)/gu) ?? [];
  assert.ok(stops.length === 1 && /[!.?]$/u.test(intro), "title: one sentence");
  const parts = sections(readme);
  const names = parts.map(({ name }) => name);
  SECTIONS.forEach((name) => {
    assert.ok(names.includes(name), `README has no section ${name}`);
  });
  assert.deepEqual(
    names,
    SECTIONS,
    "README ## sections must be SECTIONS, in order",
  );
  parts.forEach((part) => {
    assert.ok(
      part.body.trim().length > 0,
      `section ${part.name} is empty; say in one line why it does not apply`,
    );
  });
  const note = section(parts, "For coding agents").body.trim();
  assert.ok(note.split("\n").length <= 3, "For coding agents: 3 lines at most");
  return parts;
}

/** 2-4 "Use it when" bullets, then 1-3 "Do not use it when" bullets naming the alternative. @param {Section[]} parts */
function checkWhenToUse(parts) {
  const bullets = section(parts, "When to use")
    .body.replaceAll(/\n {2,}/gu, " ")
    .split("\n")
    .filter((line) => line.startsWith("- "));
  const use = bullets.filter((line) => line.startsWith("- Use it when "));
  const avoid = bullets.filter((line) =>
    line.startsWith("- Do not use it when "),
  );
  assert.ok(use.length >= 2 && use.length <= 4, "2 to 4 'Use it when' bullets");
  assert.ok(
    avoid.length > 0 && avoid.length <= 3,
    "1 to 3 'Do not use it when'",
  );
  assert.deepEqual(bullets, [...use, ...avoid], "'Use it when' bullets first");
  avoid.forEach((line) => {
    assert.match(line, /`[^`]+`/u, "'Do not use it' names the better choice");
  });
}

/** Install and first example near the top; badges below Quick start. @param {string} readme @param {string} packageName */
function checkTop(readme, packageName) {
  const lines = readme.split("\n");
  const name = packageName.replaceAll(/[$()*+./?[\\\]^{|}]/gu, String.raw`\$&`);
  const pattern = new RegExp(String.raw`\b(?:add|install)\s+${name}\b`, "u");
  const install = lines.findIndex((line) => pattern.test(line));
  assert.ok(install !== -1 && install < FIRST_LINES, "install near the top");
  const quick = section(sections(readme), "Quick start").line;
  const example = codeBlocks(readme).find((block) => block.line > quick);
  assert.ok(example && example.line <= FIRST_LINES, "example near the top");
  lines.forEach((line, index) => {
    if (/img\.shields\.io|badge\.svg/u.test(line))
      assert.ok(index + 1 > quick, "badges go below Quick start");
  });
}

/**
 * Every block tagged; README `ts`/`tsx` blocks complete and placed by path.
 * @param {Record<string, string>} texts
 * @returns {Example[]}
 */
export function checkCode(texts) {
  Object.entries(texts).forEach(([file, text]) => {
    codeBlocks(text).forEach((block) => {
      assert.ok(block.lang, `${file}:${String(block.line)} has no language`);
    });
  });
  return codeBlocks(String(texts["README.md"]))
    .filter((block) => block.lang === "ts" || block.lang === "tsx")
    .map((block) => {
      const where = `README.md:${String(block.line)}`;
      const gap = /^\s*(?:\/\/\s*)?(?:\.\.\.|…)\s*$/mu;
      assert.doesNotMatch(block.code, gap, `${where} has a ... gap`);
      const path = /^\/\/ (\S+\.m?tsx?)\n/u.exec(block.code)?.[1];
      assert.ok(path, `${where} must start with a // <path>.ts comment`);
      return { code: block.code, path };
    });
}

/** Relative links and their anchors resolve inside `root`. @param {string} root @param {Record<string, string>} texts */
function checkLinks(root, texts) {
  Object.entries(texts).forEach(([file, text]) => {
    const found = text.matchAll(/\]\((?!https?:|mailto:)([^)\s]+)\)/gu);
    [...found].forEach((match) => {
      const link = String(match[1]);
      const [target = "", anchor] = link.split("#");
      const here = join(root, file);
      const resolved = target ? join(dirname(here), target) : here;
      assert.ok(existsSync(resolved), `${file}: ${link} does not resolve`);
      if (anchor !== undefined) {
        const has = anchors(readFileSync(resolved, "utf8")).has(anchor);
        assert.ok(has, `${file}: ${link} has no such anchor`);
      }
    });
  });
}

/** @param {string} consumer @param {string} packageName @param {string[]} entries */
function probe(consumer, packageName, entries) {
  const file = join(consumer, "documentation-probe.ts");
  const statements = entries.map(
    (key, index) =>
      `import * as e${String(index)} from "${packageName}${key.slice(1)}";`,
  );
  writeFileSync(file, statements.join("\n"));
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  });
  const source = program.getSourceFile(file);
  assert.ok(source, "the export probe did not compile");
  return { checker: program.getTypeChecker(), source };
}

/** Public exports of each entry point, from the installed types. @param {string} consumer @param {string} packageName @param {string[]} entries @returns {Entry[]} */
function exportsOf(consumer, packageName, entries) {
  const { checker, source } = probe(consumer, packageName, entries);
  const statements = source.statements.filter((node) =>
    ts.isImportDeclaration(node),
  );
  return statements.map((statement, index) => {
    const entry = String(entries[index]);
    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    assert.ok(module, `cannot resolve ${entry}`);
    const symbols = checker.getExportsOfModule(module).map((symbol) => ({
      name: symbol.name,
      target:
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol,
    }));
    assert.ok(symbols.length > 0, `${entry} exports nothing`);
    return { checker, entry, symbols };
  });
}

/** @param {ts.TypeChecker} checker @param {ts.Symbol} symbol */
const hasSummary = (checker, symbol) =>
  ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
    .length > 0;

/** Public methods of a class symbol. @param {ts.TypeChecker} checker @param {ts.Symbol} symbol */
const publicMethods = (checker, symbol) =>
  checker
    .getDeclaredTypeOfSymbol(symbol)
    .getProperties()
    .filter((member) => {
      const declaration = member.declarations?.[0];
      if (!(member.flags & ts.SymbolFlags.Method) || !declaration) return false;
      const hidden = ts.ModifierFlags.NonPublicAccessibilityModifier;
      return !(ts.getCombinedModifierFlags(declaration) & hidden);
    });

/** TSDoc summary, README API row and reference heading. @param {Documented} documented @param {Entry} entry @param {Export} item */
function checkExport({ headings, table }, { checker, entry }, item) {
  const label = item.name === "default" ? entry.slice(2) : item.name;
  const row = item.name === "default" ? "`default" : `\`${label}\``;
  assert.ok(hasSummary(checker, item.target), `${label} has no TSDoc summary`);
  assert.ok(table.includes(row), `README API table lacks ${label}`);
  assert.ok(headings.has(slug(label)), `docs/API.md lacks a ${label} heading`);
  if (!(item.target.flags & ts.SymbolFlags.Class)) return;
  publicMethods(checker, item.target).forEach((method) => {
    const { name } = method;
    assert.ok(hasSummary(checker, method), `${name} has no TSDoc summary`);
    assert.ok(table.includes(`\`${name}(`), `README API table lacks ${name}`);
    assert.ok(headings.has(slug(name)), `docs/API.md lacks a ${name} heading`);
  });
}

/** A main-entry export carries `@see <package page>`. @param {Entry[]} entries @param {string} page */
function checkSee(entries, page) {
  const main = entries.find(({ entry }) => entry === ".");
  assert.ok(main, "package has no main entry");
  const linked = main.symbols.some(({ target }) =>
    target
      .getJsDocTags(main.checker)
      .some(
        (tag) =>
          tag.name === "see" &&
          ts.displayPartsToString(tag.text).includes(page),
      ),
  );
  assert.ok(linked, `a main-entry export needs TSDoc @see ${page}`);
}

/**
 * Docs cover every export of every entry point; the main entry links its page.
 * @param {string} consumer project that has the package installed
 * @param {Manifest} metadata
 * @param {Documented} documented README API table rows and docs/API.md anchors
 */
export function checkApi(consumer, metadata, documented) {
  const keys = Object.keys(metadata.exports).filter(
    (key) => key !== "./package.json" && !key.endsWith(".js"),
  );
  const entries = exportsOf(consumer, metadata.name, keys);
  entries.forEach((entry) => {
    entry.symbols.forEach((item) => {
      checkExport(documented, entry, item);
    });
  });
  const name = metadata.name.split("/").at(-1) ?? metadata.name;
  checkSee(entries, `${OSS}/packages/${name}`);
}

/**
 * Every thrown error code (`code: "X"`) and every returned reason code (an
 * upper-case `v.literal("X")`) is in the errors table and the reference.
 * @param {string} root @param {string} errors @param {string} reference
 */
function checkErrorCodes(root, errors, reference) {
  const patterns = [
    /\b(?:fail\(|code:)\s*"([A-Z][\dA-Z_]+)"/gu,
    /\bv\.literal\(\s*"([A-Z][\dA-Z_]+)"\s*\)/gu,
  ];
  const codes = new Set(
    filesUnder(join(root, "src"))
      .filter((file) => /\.tsx?$/u.test(file) && !file.includes("_generated"))
      .filter((file) => !/\.(?:test|spec)\./u.test(file))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return patterns.flatMap((pattern) =>
          [...text.matchAll(pattern)].map((match) => String(match[1])),
        );
      }),
  );
  assert.ok(codes.size > 0, "found no error codes; update the pattern");
  codes.forEach((code) => {
    assert.ok(errors.includes(`\`${code}\``), `Errors and fixes lacks ${code}`);
    assert.ok(reference.includes(code), `docs/API.md lacks ${code}`);
  });
}

/** Summary, when to use, links to the reference and errors, ecosystem block. @param {string} llms @param {string} name */
export function checkLlms(llms, name) {
  assert.match(llms, /^> \S/mu, "llms.txt needs a > summary line");
  assert.ok(llms.includes("\n## When to use\n"), "llms.txt: ## When to use");
  assert.ok(llms.includes("](./docs/API.md)"), "llms.txt: link ./docs/API.md");
  const errors = "](./README.md#errors-and-fixes)";
  assert.ok(llms.includes(errors), "llms.txt: link the errors table");
  assert.ok(llms.endsWith(ecosystem(name)), "llms.txt: ends with Ecosystem");
  const index = llms.split(`${OSS}/llms.txt`).length - 1;
  assert.equal(index, 1, "llms.txt links the package index once");
}

/**
 * No retired vllnt domain in any of `files`.
 * @param {string[]} files
 */
export function checkRetiredDomain(files) {
  files.forEach((file) => {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /vllnt\.ai/iu,
      `${file} mentions the retired vllnt domain`,
    );
  });
}

/**
 * Search metadata: a description of 160 characters at most that does not
 * mention vllnt, and 8 to 12 unique keywords.
 * @param {{ description?: unknown, keywords?: unknown }} metadata
 */
function checkMetadata({ description, keywords }) {
  assert.ok(typeof description === "string", "package.json needs description");
  assert.ok(description.length <= 160, "description: 160 characters at most");
  assert.doesNotMatch(description, /vllnt/iu, "description: not 'for vllnt'");
  assert.ok(Array.isArray(keywords), "package.json needs keywords");
  const unique = new Set(keywords);
  assert.equal(unique.size, keywords.length, "keywords repeat");
  assert.ok(unique.size >= 8 && unique.size <= 12, "8 to 12 keywords");
}

/**
 * The package.json description opens the README and is the llms.txt summary;
 * the README Links section and footer match the shared blocks.
 * @param {Record<string, string>} texts
 * @param {Section[]} parts
 * @param {Manifest} metadata
 */
function checkIdentity(texts, parts, metadata) {
  const description = String(metadata.description);
  const readme = String(texts["README.md"]);
  const title = readme.indexOf("\n");
  const intro = readme.slice(title, readme.indexOf("\n## ", title)).trim();
  const sentence = intro.replaceAll(/\s*\n\s*/gu, " ");
  assert.equal(sentence, description, "README intro: package.json description");
  const summary = String(texts["llms.txt"]).split("\n");
  assert.ok(summary.includes(`> ${description}`), "llms.txt: > <description>");
  const { repository } = metadata;
  const source = typeof repository === "object" ? repository.url : repository;
  assert.ok(typeof source === "string", "package.json needs repository.url");
  const url = source.replace(/^git\+/u, "").replace(/\.git$/u, "");
  const name = metadata.name.split("/").at(-1) ?? metadata.name;
  const body = section(parts, "Links").body.trim();
  assert.equal(body, links(name, url), "README Links: the shared block");
  assert.ok(readme.endsWith(footer(name)), "README ends with the vllnt footer");
}

/** Docs keyed by package-relative path. @param {string} root */
function readTexts(root) {
  const references = readdirSync(join(root, "docs")).map(
    (file) => `docs/${file}`,
  );
  const files = ["README.md", "llms.txt", "CHANGELOG.md", ...references];
  return Object.fromEntries(
    files.map((file) => [file, readFileSync(join(root, file), "utf8")]),
  );
}

/**
 * Checks that need no build: README shape, identity, links, error codes,
 * llms.txt, code blocks. Returns the texts, README sections and README
 * `ts`/`tsx` examples.
 * @param {string} root repository root or installed package directory
 */
export function checkSources(root) {
  /** @type {Manifest} */
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const name = metadata.name.split("/").at(-1) ?? metadata.name;
  checkMetadata(metadata);
  const texts = readTexts(root);
  const readme = String(texts["README.md"]);
  const parts = checkStructure(readme, metadata.name);
  checkWhenToUse(parts);
  checkIdentity(texts, parts, metadata);
  checkTop(readme, metadata.name);
  checkLinks(root, texts);
  checkErrorCodes(
    root,
    section(parts, "Errors and fixes").body,
    String(texts["docs/API.md"]),
  );
  checkLlms(String(texts["llms.txt"]), name);
  const examples = checkCode(texts);
  return { examples, metadata, parts, texts };
}

/**
 * Checks README.md, llms.txt and docs/ of an installed package, including
 * every export against the built types, and returns the README examples for
 * the caller to compile and run.
 * @param {string} installed package directory inside node_modules
 * @param {string} consumer project that has the package installed
 */
export function checkDocumentation(installed, consumer) {
  const { examples, metadata, parts, texts } = checkSources(installed);
  checkApi(consumer, metadata, {
    headings: anchors(String(texts["docs/API.md"])),
    table: section(parts, "API")
      .body.split("\n")
      .filter((line) => line.startsWith("|"))
      .join("\n"),
  });
  checkRetiredDomain(filesUnder(installed));
  return examples;
}

/**
 * Writes stub host files and the README examples under `consumer`, renaming
 * repeated paths, and returns the written paths.
 * @param {string} consumer @param {Record<string, string>} stubs @param {Example[]} examples
 */
export function writeHost(consumer, stubs, examples) {
  /** @type {string[]} */
  const seen = [];
  /** @type {string[]} */
  const written = [];
  const files = [
    ...Object.entries(stubs),
    ...examples.map(({ code, path }) => [path, code]),
  ];
  files.forEach(([path = "", code = ""]) => {
    const copies = seen.filter((file) => file === path).length;
    const target =
      copies === 0
        ? path
        : path.replace(/(\.m?tsx?)$/u, `.${String(copies)}$1`);
    seen.push(path);
    written.push(target);
    mkdirSync(dirname(join(consumer, target)), { recursive: true });
    writeFileSync(join(consumer, target), code);
  });
  return written;
}

/**
 * Component mount names used by the README's `convex.config.ts` blocks.
 * @param {string} installed @param {Example[]} examples
 */
function mountsOf(installed, examples) {
  const config = join(installed, "src/component/convex.config.ts");
  const definition = /defineComponent\(\s*"([^"]+)"/u;
  const component = definition.exec(readFileSync(config, "utf8"))?.[1];
  assert.ok(component, "cannot read the component name");
  const use = /app\.use\(\s*\w+\s*(?:,\s*\{\s*name:\s*"([^"]+)"\s*\})?\s*\)/gu;
  const names = examples
    .filter(({ path }) => path.endsWith("convex.config.ts"))
    .flatMap(({ code }) => [...code.matchAll(use)])
    .map((match) => match[1] ?? component);
  return [...new Set(names)];
}

/** README modules that define functions, as `api` keys. @param {Example[]} examples */
const modulesOf = (examples) =>
  [...new Set(examples.map(({ path }) => path))]
    .filter(
      (path) =>
        path.startsWith("convex/") &&
        !/convex\.config|\.test\.|_generated|schema/u.test(path),
    )
    .map((path) => path.slice("convex/".length, -".ts".length));

/**
 * Stub `convex/_generated` files typed from the README examples: `api` and
 * `internal` from the example modules, `components` from their mounts.
 * @param {string} installed @param {Example[]} examples
 * @returns {Record<string, string>}
 */
export function convexHost(installed, examples) {
  /** @type {{ name: string }} */
  const { name } = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  const modules = modulesOf(examples);
  const fields = modules.map(
    (module, index) => `"${module}": typeof m${String(index)};`,
  );
  const mounts = mountsOf(installed, examples).map(
    (mount) => `"${mount}": ComponentApi;`,
  );
  const api = [
    `import type { ComponentApi } from "${name}/_generated/component.js";`,
    `import { anyApi, componentsGeneric, type ApiFromModules, type FilterApi, type FunctionReference } from "convex/server";`,
    ...modules.map(
      (module, index) =>
        `import type * as m${String(index)} from "../${module}.js";`,
    ),
    `type FullApi = ApiFromModules<{ ${fields.join(" ")} }>;`,
    `export const api = anyApi as unknown as FilterApi<FullApi, FunctionReference<any, "public">>;`,
    `export const internal = anyApi as unknown as FilterApi<FullApi, FunctionReference<any, "internal">>;`,
    `export const components = componentsGeneric() as unknown as { ${mounts.join(" ")} };`,
  ];
  return {
    "convex/_generated/api.ts": `${api.join("\n")}\n`,
    "convex/_generated/server.ts": `export { internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, mutationGeneric as mutation, queryGeneric as query } from "convex/server";\n`,
    "convex/schema.ts": `import { defineSchema } from "convex/server";\nexport default defineSchema({});\n`,
  };
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  const root = process.cwd();
  checkRelatedPackages(
    readFileSync(join(root, "README.md"), "utf8"),
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    codeSources(root),
  );
  const { texts } = checkSources(root);
  checkRetiredDomain([
    ...Object.keys(texts).map((file) => join(root, file)),
    join(root, "package.json"),
    ...filesUnder(join(root, "src")),
  ]);
  console.log("OK    README documentation contract");
}
