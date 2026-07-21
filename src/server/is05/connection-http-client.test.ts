import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@/server/logging";
import {
  ConnectionApiError,
  ConnectionHttpClient,
} from "@/server/is05";

const logger = createLogger({ level: "silent", pretty: false });

describe("ConnectionHttpClient", () => {
  it("fetches sender active JSON and transport file", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/active")) {
        return new Response(
          JSON.stringify({
            receiver_id: null,
            master_enable: true,
            activation: { mode: "activate_immediate" },
            transport_params: [{ rtp_enabled: true }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("v=0\r\n", {
        status: 200,
        headers: { "Content-Type": "application/sdp" },
      });
    });

    const client = new ConnectionHttpClient({
      baseUrl: "http://device/x-nmos/connection/v1.1/",
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.getSenderActive("s1")).resolves.toMatchObject({
      master_enable: true,
      transport_params: [{ rtp_enabled: true }],
    });
    await expect(client.getSenderTransportFile("s1")).resolves.toEqual({
      contentType: "application/sdp",
      data: "v=0\r\n",
    });
  });

  it("returns null transport file on 404", async () => {
    const fetchImpl = vi.fn(async () => new Response("missing", { status: 404 }));
    const client = new ConnectionHttpClient({
      baseUrl: "http://device/x-nmos/connection/v1.1/",
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getSenderTransportFile("s1")).resolves.toBeNull();
  });

  it("fetches receiver active with embedded transport_file", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sender_id: "sender-1",
          master_enable: true,
          activation: {},
          transport_file: { data: "v=0", type: "application/sdp" },
          transport_params: [],
        }),
        { status: 200 },
      ),
    );
    const client = new ConnectionHttpClient({
      baseUrl: "http://device/x-nmos/connection/v1.1/",
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const active = await client.getReceiverActive("r1");
    expect(active.transport_file.data).toBe("v=0");
  });

  it("maps HTTP errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));
    const client = new ConnectionHttpClient({
      baseUrl: "http://device/x-nmos/connection/v1.1/",
      logger,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getSenderActive("s1")).rejects.toBeInstanceOf(
      ConnectionApiError,
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

    const client = new ConnectionHttpClient({
      baseUrl: "http://device/x-nmos/connection/v1.1/",
      logger,
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(client.getSenderActive("s1")).rejects.toThrow(/timed out/);
  });
});
