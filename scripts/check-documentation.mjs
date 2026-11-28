// Documentation contract shared by @vllnt packages. Only the "Related packages"
// rule is checked here for now; run as a script it checks this repo's README.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const OSS = "https://oss.vllnt.com";
/** Folders whose sources count as code that uses another package. */
const CODE_FOLDERS = ["src", "example"];

/**
 * @typedef {{ code: string, lang: string, line: number }} Block
 * @typedef {{ lang: string, line: number, lines: string[] }} OpenBlock
 * @typedef {{ body: string, line: number, name: string }} Section
 * @typedef {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} Metadata
 */

/** Fenced code blocks with 1-based start lines. @param {string} text */
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
    const block = { code: lines.join("\n"), lang, line: at };
    return { blocks: [...current.blocks, block], open: undefined };
  }, start);
  assert.equal(state.open, undefined, "unclosed code block");
  return state.blocks;
}

/** Lines outside code blocks with 1-based line numbers. @param {string} text */
function linesOutsideCode(text) {
  const inCode = new Set(
    codeBlocks(text).flatMap(({ code, line }) =>
      Array.from(
        { length: code.split("\n").length + 2 },
        (_, offset) => line + offset,
      ),
    ),
  );
  return text
    .split("\n")
    .map((content, index) => ({ content, line: index + 1 }))
    .filter(({ line }) => !inCode.has(line));
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
  const links = related.body.matchAll(/\[`?@vllnt\/([\w-]+)`?\]\(([^)]+)\)/gu);
  [...links].forEach(([, other = "", url]) => {
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

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  const root = process.cwd();
  checkRelatedPackages(
    readFileSync(join(root, "README.md"), "utf8"),
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    codeSources(root),
  );
  console.log("OK    README documentation contract");
}
