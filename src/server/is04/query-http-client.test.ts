import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import {
  QueryApiError,
  QueryHttpClient,
  findNcpControl,
  isNcpControlType,
} from "@/server/is04";

describe("isNcpControlType / findNcpControl", () => {
  it("matches ncp control type prefix", () => {
    expect(isNcpControlType("urn:x-nmos:control:ncp")).toBe(true);
    expect(isNcpControlType("urn:x-nmos:control:ncp/v1.0")).toBe(true);
    expect(isNcpControlType("urn:x-nmos:control:sr-ctrl/v1.1")).toBe(false);
  });

  it("finds the ncp control in a controls array", () => {
    const control = findNcpControl([
      { type: "urn:x-nmos:control:sr-ctrl/v1.1", href: "http://x" },
      {
        type: "urn:x-nmos:control:ncp/v1.0",
        href: "ws://127.0.0.1:8080/x-nmos/ncp/v1.0/connect",
      },
    ]);
    expect(control?.href).toContain("ncp");
    expect(findNcpControl([])).toBeUndefined();
    expect(findNcpControl(undefined)).toBeUndefined();
  });
});

describe("QueryHttpClient", () => {
  const logger = createLogger({ level: "silent", pretty: false });

  it("GETs JSON successfully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: "a" }]),
    });

    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
    });

    const result = await client.getJson<Array<{ id: string }>>("/nodes");
    expect(result).toEqual([{ id: "a" }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://registry:3211/x-nmos/query/v1.3/nodes",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws QueryApiError on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3/",
      logger,
      fetchImpl,
    });

    await expect(client.getJson("/nodes")).rejects.toBeInstanceOf(QueryApiError);
  });

  it("throws QueryApiError on invalid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{bad",
    });

    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
    });

    await expect(client.getJson("/nodes")).rejects.toThrow(/invalid JSON/);
  });

  it("POSTs JSON and returns the response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: "sub-1", ws_href: "ws://x" }),
    });

    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
    });

    const result = await client.postJson("/subscriptions", { persist: false });
    expect(result).toEqual({ id: "sub-1", ws_href: "ws://x" });
  });

  it("DELETE ignores 404 and throws on other errors", async () => {
    const fetch404 = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
    });
    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl: fetch404,
    });
    await expect(client.delete("/subscriptions/x")).resolves.toBeUndefined();

    const fetch500 = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "nope",
    });
    const failing = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl: fetch500,
    });
    await expect(failing.delete("/subscriptions/x")).rejects.toBeInstanceOf(
      QueryApiError,
    );
  });

  it("maps abort to a timeout error", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(client.getJson("/nodes")).rejects.toThrow(/timed out/);
  });

  it("handles POST and DELETE timeout / invalid JSON paths", async () => {
    const invalidPost = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{bad",
    });
    const clientInvalid = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl: invalidPost,
    });
    await expect(clientInvalid.postJson("/subscriptions", {})).rejects.toThrow(
      /invalid JSON/,
    );

    const failingPost = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
    });
    const clientFail = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl: failingPost,
    });
    await expect(clientFail.postJson("/subscriptions", {})).rejects.toThrow(
      /failed with 400/,
    );

    const aborting = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    const clientTimeout = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3",
      logger,
      fetchImpl: aborting,
      timeoutMs: 5,
    });
    await expect(clientTimeout.postJson("/subscriptions", {})).rejects.toThrow(
      /timed out/,
    );
    await expect(clientTimeout.delete("/subscriptions/x")).rejects.toThrow(
      /timed out/,
    );
  });

  it("exposes the configured base URL", () => {
    const client = new QueryHttpClient({
      baseUrl: "http://registry:3211/x-nmos/query/v1.3/",
      logger,
      fetchImpl: vi.fn(),
    });
    expect(client.getBaseUrl()).toBe(
      "http://registry:3211/x-nmos/query/v1.3",
    );
  });
});
