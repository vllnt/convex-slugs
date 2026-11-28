// Requests every external URL in the shipped docs and expects HTTP 200 after
// redirects. Not a CI gate: it depends on the network and on other sites.
// npmjs.com answers 403 to scripted requests, so npm package links are checked
// with `npm view <name> name` instead.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const FILES = ["README.md", "docs/API.md", "llms.txt", "CHANGELOG.md"];
const NPM = /^https:\/\/www\.npmjs\.com\/package\/((?:@[\w.-]+\/)?[\w.-]+)$/u;

const urls = [
  ...new Set(
    FILES.flatMap((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(/https?:\/\/[^\s)<>"'`\]]+/gu),
      ].map((match) => match[0].replace(/[.,;:]+$/u, "")),
    ),
  ),
].sort();

/** @param {string} url @returns {Promise<string>} */
async function status(url) {
  const npm = NPM.exec(url)?.[1];
  if (npm !== undefined) {
    const name = execFileSync("npm", ["view", npm, "name"], {
      encoding: "utf8",
    });
    return name.trim() === npm ? "200 (npm view)" : "missing on npm";
  }
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "docs-link-check" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    return String(response.status);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const results = await Promise.all(
  urls.map(async (url) => ({ status: await status(url), url })),
);
results.forEach((result) => {
  console.log(`${result.status.padEnd(16)} ${result.url}`);
});
const failed = results.filter((result) => !result.status.startsWith("200"));
console.log(
  `${String(results.length - failed.length)}/${String(results.length)} links answer 200`,
);
if (failed.length > 0) process.exitCode = 1;
