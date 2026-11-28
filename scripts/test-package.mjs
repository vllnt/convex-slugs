import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  checkDocumentation,
  convexHost,
  writeHost,
} from "./check-documentation.mjs";

// Files the published package must contain; agents read the docs from node_modules.
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
  "dist/client/index.js",
  "dist/client/index.d.ts",
  "dist/react/index.js",
  "dist/react/index.d.ts",
  "dist/component/convex.config.js",
  "dist/component/convex.config.d.ts",
  "dist/component/_generated/component.d.ts",
  "src/test.ts",
];

const root = process.cwd();
/** @type {unknown} */
const metadata = JSON.parse(readFileSync("package.json", "utf8"));
if (
  typeof metadata !== "object" ||
  metadata === null ||
  !("name" in metadata) ||
  !("version" in metadata) ||
  typeof metadata.name !== "string" ||
  typeof metadata.version !== "string"
)
  throw new Error("invalid package metadata");
// The root minimumReleaseAge and minimumReleaseAgeExclude blocks, copied verbatim.
const releaseAgeBlocks = readFileSync("pnpm-workspace.yaml", "utf8").match(
  /^minimumReleaseAge(?:Exclude)?:.*\n?(?:[\t ]+.*\n?)*/gm,
);
if (!releaseAgeBlocks?.some((block) => block.startsWith("minimumReleaseAge:")))
  throw new Error("pnpm-workspace.yaml: minimumReleaseAge is missing");
const releaseAge = releaseAgeBlocks.join("");
const tarball = `${metadata.name.replace("@", "").replace("/", "-")}-${metadata.version}.tgz`;
const temporary = mkdtempSync(join(tmpdir(), "slugs-consumer-"));
/** @param {string} command @param {string[]} arguments_ @param {string} [cwd] */
const run = (command, arguments_, cwd = temporary) =>
  execFileSync(command, arguments_, { cwd, stdio: "inherit" });
try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      pnpm: { ignoredBuiltDependencies: ["esbuild"] },
      private: true,
      type: "module",
    }),
  );
  // pnpm 11 reads the build-script policy from the workspace file, pnpm 10 from package.json.
  // No lockfile here, and the temp project sits outside the repo: copy the root release-age
  // rule so floating transitive deps follow the same 7-day gate.
  writeFileSync(
    join(temporary, "pnpm-workspace.yaml"),
    `allowBuilds:\n  esbuild: false\n${releaseAge}`,
  );
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.45.0",
    "typescript@5.9.3",
    "convex-test@0.0.56",
    "vite@8.2.2",
    "@types/node@22.20.2",
    "vitest@5.1.1",
    "@edge-runtime/vm@5.0.0",
    // Lowest supported React major (18), for the optional ./react entry.
    "react@18.3.1",
    "@types/react@18.3.31",
  ]);

  const installed = join(temporary, "node_modules", metadata.name);
  const missing = REQUIRED.filter((file) => !existsSync(join(installed, file)));
  if (missing.length > 0)
    throw new Error(`package contents: missing [${missing.join(", ")}]`);
  console.log(`OK    ${REQUIRED.length} required files in the package`);

  // Docs contract on what consumers receive, then the README examples
  // type-checked against the built package in a stub Convex host.
  const examples = checkDocumentation(installed, temporary);
  console.log("OK    documentation contract on the installed package");
  const hostFiles = writeHost(
    temporary,
    convexHost(installed, examples),
    examples,
  );
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--target",
    "ES2022",
    "--jsx",
    "react-jsx",
    "--types",
    "vite/client,node",
    ...hostFiles,
  ]);
  console.log(`OK    ${String(examples.length)} README examples type-check`);
  // The README's own vitest.config.mts runs its test example.
  run("pnpm", ["exec", "vitest", "run"]);

  writeFileSync(
    join(temporary, "consumer.ts"),
    `
import { Slugs } from "@vllnt/convex-slugs";
import type { ComponentApi } from "@vllnt/convex-slugs/_generated/component.js";
import type { ComponentApi as BareComponentApi } from "@vllnt/convex-slugs/_generated/component";
import config from "@vllnt/convex-slugs/convex.config.js";
import bareConfig from "@vllnt/convex-slugs/convex.config";
import { useResolve, useSlugAvailable } from "@vllnt/convex-slugs/react";
import { defineApp, type FunctionReference } from "convex/server";
declare const component: ComponentApi;
declare const bareComponent: BareComponentApi;
declare const resolve: FunctionReference<"query", "public", { slug: string; scope?: string }, string | null>;
const client = new Slugs(component);
const bareClient = new Slugs(bareComponent);
const app = defineApp(); app.use(config); app.use(bareConfig, { name: "bare" });
const hooks = (): [string | null | undefined, boolean | undefined] => [useResolve(resolve, { slug: "ada" }), useSlugAvailable(resolve, { slug: "ada", scope: "users" }).available];
void client; void bareClient; void app; void hooks;
`,
  );
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "consumer.ts",
  ]);
  writeFileSync(
    join(temporary, "registration.ts"),
    `
import { register } from "@vllnt/convex-slugs/test";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
const host = defineSchema({ unrelated: defineTable({ label: v.string() }) });
register(convexTest(host, {}), "custom");
`,
  );
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--target",
    "ES2022",
    "--types",
    "vite/client,node",
    "registration.ts",
  ]);
  // The shipped test helper is TypeScript source: it must also compile for NodeNext consumers.
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "--types",
    "node",
    "registration.ts",
  ]);
  run("node", [
    "--input-type=module",
    "-e",
    'import { Slugs } from "@vllnt/convex-slugs"; import config from "@vllnt/convex-slugs/convex.config.js"; import bareConfig from "@vllnt/convex-slugs/convex.config"; import { useResolve, useSlugAvailable } from "@vllnt/convex-slugs/react"; if (!Slugs || !config || !bareConfig || typeof useResolve !== "function" || typeof useSlugAvailable !== "function") throw Error("missing export");',
  ]);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
