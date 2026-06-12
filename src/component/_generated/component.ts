/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      release: FunctionReference<
        "mutation",
        "internal",
        { scope: string; slug: string },
        null,
        Name
      >;
      rename: FunctionReference<
        "mutation",
        "internal",
        {
          bounds: { maxLength: number; minLength: number };
          fromSlug: string;
          scope: string;
          toSlug: string;
        },
        {
          ok: boolean;
          reason?:
            | "SLUG_TAKEN"
            | "SLUG_NOT_FOUND"
            | "SLUG_INVALID"
            | "SLUG_RESERVED";
        },
        Name
      >;
      reserve: FunctionReference<
        "mutation",
        "internal",
        {
          bounds: { maxLength: number; minLength: number };
          resourceRef: string;
          scope: string;
          slug: string;
        },
        {
          ok: boolean;
          reason?:
            | "SLUG_TAKEN"
            | "SLUG_NOT_FOUND"
            | "SLUG_INVALID"
            | "SLUG_RESERVED";
        },
        Name
      >;
    };
    queries: {
      redirectFor: FunctionReference<
        "query",
        "internal",
        { scope: string; slug: string },
        null | string,
        Name
      >;
      resolve: FunctionReference<
        "query",
        "internal",
        { scope: string; slug: string },
        null | string,
        Name
      >;
      slugForResource: FunctionReference<
        "query",
        "internal",
        { resourceRef: string; scope: string },
        null | string,
        Name
      >;
    };
  };
