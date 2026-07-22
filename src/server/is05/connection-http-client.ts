import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";

import {
  receiverActivePath,
  senderActivePath,
  senderTransportFilePath,
} from "./paths";
import type {
  Is05ReceiverActive,
  Is05SenderActive,
  Is05TransportFileView,
} from "./types";

export class ConnectionApiError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(
    message: string,
    options?: { status?: number; body?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ConnectionApiError";
    this.status = options?.status;
    this.body = options?.body;
  }
}

export type ConnectionHttpClientOptions = {
  baseUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Read-only IS-05 Connection API client (GET only).
 */
export class ConnectionHttpClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ConnectionHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.logger = childLogger(options.logger, { component: "is05-http" });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getSenderActive(senderId: string): Promise<Is05SenderActive> {
    return this.getJson<Is05SenderActive>(senderActivePath(senderId));
  }

  async getReceiverActive(receiverId: string): Promise<Is05ReceiverActive> {
    return this.getJson<Is05ReceiverActive>(receiverActivePath(receiverId));
  }

  /**
   * Fetch sender transport file (SDP). Returns null on 404.
   */
  async getSenderTransportFile(
    senderId: string,
  ): Promise<Is05TransportFileView | null> {
    const path = senderTransportFilePath(senderId);
    const url = joinUrl(this.baseUrl, path);
    this.logger.debug({ url }, "GET Connection API transportfile");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/sdp, text/plain, */*" },
        signal: controller.signal,
      });

      if (response.status === 404) {
        return null;
      }

      const bodyText = await response.text();
      if (!response.ok) {
        throw new ConnectionApiError(
          `Connection API GET ${path} failed with ${response.status}`,
          { status: response.status, body: bodyText },
        );
      }

      const contentType =
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        "application/sdp";
      return { contentType, data: bodyText };
    } catch (error) {
      if (error instanceof ConnectionApiError) {
        this.logger.error(
          { err: error, path, status: error.status },
          "Connection API transportfile request failed",
        );
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Connection API GET ${path} timed out after ${this.timeoutMs}ms`
          : `Connection API GET ${path} failed`;

      this.logger.error({ err: error, path }, message);
      throw new ConnectionApiError(message, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = joinUrl(this.baseUrl, path);
    this.logger.debug({ url }, "GET Connection API");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new ConnectionApiError(
          `Connection API GET ${path} failed with ${response.status}`,
          { status: response.status, body: bodyText },
        );
      }

      try {
        return JSON.parse(bodyText) as T;
      } catch (error) {
        throw new ConnectionApiError(
          `Connection API GET ${path} returned invalid JSON`,
          { status: response.status, body: bodyText, cause: error },
        );
      }
    } catch (error) {
      if (error instanceof ConnectionApiError) {
        this.logger.error(
          { err: error, path, status: error.status },
          "Connection API request failed",
        );
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Connection API GET ${path} timed out after ${this.timeoutMs}ms`
          : `Connection API GET ${path} failed`;

      this.logger.error({ err: error, path }, message);
      throw new ConnectionApiError(message, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
