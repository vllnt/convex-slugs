/// <reference types="vite/client" />
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can
 * test integration: `import { register } from "@vllnt/convex-slugs/test"`.
 * `t` may be built from the host app's own schema.
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "slugs",
): void {
  t.registerComponent(name, schema, modules);
}
