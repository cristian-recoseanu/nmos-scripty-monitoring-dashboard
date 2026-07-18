import { EventEmitter } from "node:events";

import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";

import { parseGrainMessage, type ParsedGrainEvent } from "./grains";
import type { QueryHttpClient } from "./query-http-client";
import type { ResourcePath } from "./types";

export type SubscriptionRequest = {
  max_update_rate_ms: number;
  resource_path: ResourcePath;
  params: Record<string, string>;
  persist: boolean;
  secure: boolean;
  authorization?: boolean;
};

export type SubscriptionResponse = {
  id: string;
  ws_href: string;
  max_update_rate_ms: number;
  resource_path: ResourcePath | string;
  params: Record<string, string>;
  persist: boolean;
  secure: boolean;
};

export type GrainListener = (events: ParsedGrainEvent[]) => void;

export type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (
    type: string,
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
  ) => void;
};

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;

export type QuerySubscriptionClientOptions = {
  http: QueryHttpClient;
  logger: Logger;
  secureWs: boolean;
  webSocketFactory?: WebSocketFactory;
  maxUpdateRateMs?: number;
  persist?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

type ActiveSubscription = {
  resourcePath: ResourcePath;
  subscriptionId: string;
  wsHref: string;
  socket: WebSocketLike | null;
  reconnectAttempt: number;
  closed: boolean;
  reconnectTimer?: ReturnType<typeof setTimeout>;
};

/**
 * Creates IS-04 Query API subscriptions and consumes WebSocket data grains.
 */
export class QuerySubscriptionClient extends EventEmitter {
  private readonly http: QueryHttpClient;
  private readonly logger: Logger;
  private readonly secureWs: boolean;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly maxUpdateRateMs: number;
  private readonly persist: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly subscriptions = new Map<ResourcePath, ActiveSubscription>();

  constructor(options: QuerySubscriptionClientOptions) {
    super();
    this.http = options.http;
    this.logger = childLogger(options.logger, { component: "is04-ws" });
    this.secureWs = options.secureWs;
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.maxUpdateRateMs = options.maxUpdateRateMs ?? 100;
    this.persist = options.persist ?? false;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
  }

  async subscribeAll(paths: readonly ResourcePath[]): Promise<void> {
    const failures: Array<{ path: ResourcePath; error: unknown }> = [];

    for (const path of paths) {
      try {
        await this.subscribe(path);
      } catch (error) {
        failures.push({ path, error });
        this.logger.error(
          { err: error, resourcePath: path },
          "Failed to create Query subscription for resource path",
        );
      }
    }

    if (failures.length === paths.length) {
      throw new Error(
        `All Query API subscriptions failed (${failures.length} paths)`,
      );
    }

    if (failures.length > 0) {
      this.logger.warn(
        {
          failed: failures.map((failure) => failure.path),
          ok: paths.length - failures.length,
        },
        "Partial Query API subscription success",
      );
    }
  }

  async subscribe(resourcePath: ResourcePath): Promise<SubscriptionResponse> {
    const existing = this.subscriptions.get(resourcePath);
    if (existing && !existing.closed) {
      this.logger.debug(
        { resourcePath, subscriptionId: existing.subscriptionId },
        "Subscription already active",
      );
      return {
        id: existing.subscriptionId,
        ws_href: existing.wsHref,
        max_update_rate_ms: this.maxUpdateRateMs,
        resource_path: resourcePath,
        params: {},
        persist: this.persist,
        secure: this.secureWs,
      };
    }

    const request: SubscriptionRequest = {
      max_update_rate_ms: this.maxUpdateRateMs,
      resource_path: resourcePath,
      params: {},
      persist: this.persist,
      secure: this.secureWs,
    };

    const response = await this.http.postJson<
      SubscriptionRequest,
      SubscriptionResponse
    >("/subscriptions", request);

    const active: ActiveSubscription = {
      resourcePath,
      subscriptionId: response.id,
      wsHref: response.ws_href,
      socket: null,
      reconnectAttempt: 0,
      closed: false,
    };
    this.subscriptions.set(resourcePath, active);

    this.logger.info(
      {
        resourcePath,
        subscriptionId: response.id,
        wsHref: response.ws_href,
      },
      "Created Query API subscription",
    );

    this.openSocket(active);
    return response;
  }

  async stop(): Promise<void> {
    for (const active of this.subscriptions.values()) {
      active.closed = true;
      if (active.reconnectTimer) {
        clearTimeout(active.reconnectTimer);
      }
      active.socket?.close();
      if (!this.persist) {
        // Non-persistent subscriptions are removed when the WS closes; skip DELETE.
        continue;
      }
      try {
        await this.http.delete(`/subscriptions/${active.subscriptionId}`);
      } catch (error) {
        this.logger.warn(
          { err: error, subscriptionId: active.subscriptionId },
          "Failed to delete persistent subscription",
        );
      }
    }
    this.subscriptions.clear();
  }

  private openSocket(active: ActiveSubscription): void {
    if (active.closed) {
      return;
    }

    const log = childLogger(this.logger, {
      resourcePath: active.resourcePath,
      subscriptionId: active.subscriptionId,
      connectionId: `${active.resourcePath}:${active.subscriptionId}`,
    });

    log.info({ wsHref: active.wsHref }, "Opening Query API WebSocket");

    let socket: WebSocketLike;
    try {
      socket = this.webSocketFactory(active.wsHref);
    } catch (error) {
      log.error({ err: error }, "Failed to construct WebSocket");
      this.scheduleReconnect(active);
      return;
    }

    active.socket = socket;

    const onMessage = (event: { data?: unknown }) => {
      try {
        const raw =
          typeof event.data === "string"
            ? JSON.parse(event.data)
            : event.data;
        const events = parseGrainMessage(raw);
        this.emit("grains", events, active.resourcePath);
      } catch (error) {
        log.warn({ err: error }, "Failed to parse grain message");
        this.emit("malformedGrain", error);
      }
    };

    const onClose = () => {
      log.warn("Query API WebSocket closed");
      this.emit("disconnected", active.resourcePath);
      if (!active.closed) {
        this.scheduleReconnect(active);
      }
    };

    const onError = () => {
      log.error("Query API WebSocket error");
    };

    const onOpen = () => {
      active.reconnectAttempt = 0;
      log.info("Query API WebSocket connected");
      this.emit("connected", active.resourcePath);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    socket.addEventListener("open", onOpen);

    // Some mocks open synchronously before listeners attach.
    if (socket.readyState === WS_OPEN) {
      onOpen();
    }
  }

  private scheduleReconnect(active: ActiveSubscription): void {
    if (active.closed) {
      return;
    }

    const attempt = active.reconnectAttempt++;
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** attempt,
      this.reconnectMaxMs,
    );

    this.logger.info(
      {
        resourcePath: active.resourcePath,
        subscriptionId: active.subscriptionId,
        delayMs: delay,
        attempt: attempt + 1,
      },
      "Scheduling Query API WebSocket reconnect",
    );

    this.emit("reconnectScheduled", {
      resourcePath: active.resourcePath,
      attempt: attempt + 1,
      delayMs: delay,
    });

    active.reconnectTimer = setTimeout(() => {
      this.openSocket(active);
    }, delay);
  }
}
