import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";

export class QueryApiError extends Error {
  readonly status?: number;
  readonly body?: string;

  constructor(
    message: string,
    options?: { status?: number; body?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "QueryApiError";
    this.status = options?.status;
    this.body = options?.body;
  }
}

export type QueryHttpClientOptions = {
  baseUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
};

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export class QueryHttpClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: QueryHttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.logger = childLogger(options.logger, { component: "is04-http" });
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getJson<T>(path: string): Promise<T> {
    const url = joinUrl(this.baseUrl, path);
    this.logger.debug({ url }, "GET Query API");

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
        throw new QueryApiError(
          `Query API GET ${path} failed with ${response.status}`,
          { status: response.status, body: bodyText },
        );
      }

      try {
        return JSON.parse(bodyText) as T;
      } catch (error) {
        throw new QueryApiError(`Query API GET ${path} returned invalid JSON`, {
          status: response.status,
          body: bodyText,
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof QueryApiError) {
        this.logger.error(
          { err: error, path, status: error.status },
          "Query API request failed",
        );
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Query API GET ${path} timed out after ${this.timeoutMs}ms`
          : `Query API GET ${path} failed`;

      this.logger.error({ err: error, path }, message);
      throw new QueryApiError(message, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async postJson<TRequest, TResponse>(
    path: string,
    payload: TRequest,
  ): Promise<TResponse> {
    const url = joinUrl(this.baseUrl, path);
    this.logger.debug({ url }, "POST Query API");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new QueryApiError(
          `Query API POST ${path} failed with ${response.status}`,
          { status: response.status, body: bodyText },
        );
      }

      try {
        return JSON.parse(bodyText) as TResponse;
      } catch (error) {
        throw new QueryApiError(`Query API POST ${path} returned invalid JSON`, {
          status: response.status,
          body: bodyText,
          cause: error,
        });
      }
    } catch (error) {
      if (error instanceof QueryApiError) {
        this.logger.error(
          { err: error, path, status: error.status },
          "Query API POST failed",
        );
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Query API POST ${path} timed out after ${this.timeoutMs}ms`
          : `Query API POST ${path} failed`;

      this.logger.error({ err: error, path }, message);
      throw new QueryApiError(message, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async delete(path: string): Promise<void> {
    const url = joinUrl(this.baseUrl, path);
    this.logger.debug({ url }, "DELETE Query API");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "DELETE",
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 404) {
        const bodyText = await response.text();
        throw new QueryApiError(
          `Query API DELETE ${path} failed with ${response.status}`,
          { status: response.status, body: bodyText },
        );
      }
    } catch (error) {
      if (error instanceof QueryApiError) {
        this.logger.error(
          { err: error, path, status: error.status },
          "Query API DELETE failed",
        );
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `Query API DELETE ${path} timed out after ${this.timeoutMs}ms`
          : `Query API DELETE ${path} failed`;

      this.logger.error({ err: error, path }, message);
      throw new QueryApiError(message, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
