import { EventEmitter } from "node:events";

import type { AppConfig } from "@/config";
import { buildQueryApiBaseUrl, resolveSecureWs } from "@/config";
import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";
import {
  QueryHttpClient,
  QuerySubscriptionClient,
  RESOURCE_PATHS,
  ResourceStore,
  type ParsedGrainEvent,
  type ResourcePath,
} from "@/server/is04";
import {
  incrementMetric,
  incrementSubscriptionRetries,
} from "@/server/runtime/metrics";

export type Is04OrchestratorOptions = {
  config: AppConfig;
  store: ResourceStore;
  logger: Logger;
  webSocketFactory?: ConstructorParameters<
    typeof QuerySubscriptionClient
  >[0]["webSocketFactory"];
  fetchImpl?: typeof fetch;
  retryBaseMs?: number;
  retryMaxMs?: number;
};

/**
 * Keeps the ResourceStore in sync with an IS-04 Query API via WebSocket grains.
 * Retries subscription setup when the registry is unreachable.
 */
export class Is04Orchestrator extends EventEmitter {
  readonly store: ResourceStore;
  readonly queryApiBaseUrl: string;

  private readonly http: QueryHttpClient;
  private readonly subscriptions: QuerySubscriptionClient;
  private readonly logger: Logger;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private connectedPaths = new Set<ResourcePath>();
  private lastError?: string;
  private started = false;
  private retryAttempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private maintaining = false;

  constructor(options: Is04OrchestratorOptions) {
    super();
    this.store = options.store;
    this.logger = childLogger(options.logger, { component: "is04-orchestrator" });
    this.queryApiBaseUrl = buildQueryApiBaseUrl(options.config);
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
    this.http = new QueryHttpClient({
      baseUrl: this.queryApiBaseUrl,
      logger: this.logger,
      fetchImpl: options.fetchImpl,
    });
    this.subscriptions = new QuerySubscriptionClient({
      http: this.http,
      logger: this.logger,
      secureWs: resolveSecureWs(options.config),
      webSocketFactory: options.webSocketFactory,
      persist: false,
    });

    this.subscriptions.on(
      "grains",
      (events: ParsedGrainEvent[], resourcePath: ResourcePath) => {
        this.store.applyGrains(events, resourcePath);
        incrementMetric("grainsApplied", events.length);
        this.emit("grains", events, resourcePath);
        this.emit("changed");
      },
    );

    this.subscriptions.on("malformedGrain", () => {
      incrementMetric("malformedGrains");
    });

    this.subscriptions.on("reconnectScheduled", () => {
      incrementMetric("is04WsReconnects");
    });

    this.subscriptions.on("connected", (resourcePath: ResourcePath) => {
      this.connectedPaths.add(resourcePath);
      this.lastError = undefined;
      this.retryAttempt = 0;
      this.logger.info({ resourcePath }, "Query subscription connected");
      this.emit("connection", this.getConnectionState());
    });

    this.subscriptions.on("disconnected", (resourcePath: ResourcePath) => {
      this.connectedPaths.delete(resourcePath);
      this.logger.warn({ resourcePath }, "Query subscription disconnected");
      this.emit("connection", this.getConnectionState());
      // WebSocket reconnect is handled by QuerySubscriptionClient.
    });
  }

  getConnectionState(): {
    connected: boolean;
    connectedPaths: ResourcePath[];
    lastError?: string;
    queryApiBaseUrl: string;
    retrying: boolean;
  } {
    return {
      connected: this.connectedPaths.size > 0,
      connectedPaths: [...this.connectedPaths],
      lastError: this.lastError,
      queryApiBaseUrl: this.queryApiBaseUrl,
      retrying: this.retryTimer !== undefined || this.maintaining,
    };
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.logger.info(
      { queryApiBaseUrl: this.queryApiBaseUrl },
      "Starting IS-04 Query orchestrator",
    );
    await this.ensureSubscriptions();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.maintaining = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    await this.subscriptions.stop();
    this.connectedPaths.clear();
  }

  private async ensureSubscriptions(): Promise<void> {
    if (!this.started || this.maintaining) {
      return;
    }
    this.maintaining = true;

    try {
      await this.subscriptions.subscribeAll(RESOURCE_PATHS);
      this.lastError = undefined;
      this.retryAttempt = 0;
      this.logger.info("Query API subscriptions established");
      this.emit("connection", this.getConnectionState());
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "Failed to subscribe";
      this.logger.error({ err: error }, "Failed to create Query subscriptions");
      this.emit("connection", this.getConnectionState());
      this.scheduleSubscriptionRetry(this.lastError);
    } finally {
      this.maintaining = false;
    }
  }

  private scheduleSubscriptionRetry(reason: string): void {
    if (!this.started || this.retryTimer) {
      return;
    }

    const attempt = this.retryAttempt++;
    const delay = Math.min(
      this.retryBaseMs * 2 ** attempt,
      this.retryMaxMs,
    );
    incrementSubscriptionRetries();

    this.logger.info(
      { delayMs: delay, attempt: attempt + 1, reason },
      "Scheduling IS-04 subscription retry",
    );
    this.emit("connection", this.getConnectionState());

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.ensureSubscriptions();
    }, delay);
  }
}
