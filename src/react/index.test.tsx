// @vitest-environment jsdom

/**
 * Unit tests for the optional React front-tooling hooks. `convex/react`'s
 * `useQuery` is mocked so the hooks are exercised in isolation — no live Convex
 * client. Runs under jsdom (per-file pragma above) while the global vitest env
 * stays edge-runtime for the backend suite.
 */

import { renderHook } from "@testing-library/react";
import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useResolve, useSlugAvailable } from "./index";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);

// A stand-in for the host's re-exported `resolve` query reference. The hooks
// only forward it to `useQuery`, so an opaque cast is sufficient for the test.
const resolveRef = "resolveRef" as unknown as FunctionReference<
  "query",
  "public",
  { slug: string; scope?: string },
  string | null
>;

beforeEach(() => {
  mockedUseQuery.mockReset();
});

describe("useResolve", () => {
  it("forwards (ref, args) to useQuery and returns the held resourceRef", () => {
    mockedUseQuery.mockReturnValue("user_1");
    const args = { slug: "my-handle", scope: "users" };

    const { result } = renderHook(() => useResolve(resolveRef, args));

    expect(mockedUseQuery).toHaveBeenCalledWith(resolveRef, args);
    expect(result.current).toBe("user_1");
  });

  it("returns undefined while the query is loading", () => {
    mockedUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() =>
      useResolve(resolveRef, { slug: "loading" }),
    );

    expect(result.current).toBeUndefined();
  });

  it("returns null when the slug is free", () => {
    mockedUseQuery.mockReturnValue(null);

    const { result } = renderHook(() =>
      useResolve(resolveRef, { slug: "free" }),
    );

    expect(result.current).toBeNull();
  });
});

describe("useSlugAvailable", () => {
  it("forwards (ref, args) to useQuery", () => {
    mockedUseQuery.mockReturnValue(null);
    const args = { slug: "candidate", scope: "users" };

    renderHook(() => useSlugAvailable(resolveRef, args));

    expect(mockedUseQuery).toHaveBeenCalledWith(resolveRef, args);
  });

  it("loading: useQuery undefined -> available undefined, resourceRef null", () => {
    mockedUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() =>
      useSlugAvailable(resolveRef, { slug: "loading" }),
    );

    expect(result.current.available).toBeUndefined();
    expect(result.current.resourceRef).toBeNull();
  });

  it("free: useQuery null -> available true, resourceRef null", () => {
    mockedUseQuery.mockReturnValue(null);

    const { result } = renderHook(() =>
      useSlugAvailable(resolveRef, { slug: "free" }),
    );

    expect(result.current.available).toBe(true);
    expect(result.current.resourceRef).toBeNull();
  });

  it("taken: useQuery string -> available false, resourceRef the holder", () => {
    mockedUseQuery.mockReturnValue("user_42");

    const { result } = renderHook(() =>
      useSlugAvailable(resolveRef, { slug: "taken" }),
    );

    expect(result.current.available).toBe(false);
    expect(result.current.resourceRef).toBe("user_42");
  });
});
