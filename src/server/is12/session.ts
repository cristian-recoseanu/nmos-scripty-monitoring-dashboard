import { EventEmitter } from "node:events";

import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";

import {
  MessageType,
  METHOD_GET,
  METHOD_SET,
  type Is12Command,
  type Is12CommandResponse,
  type Is12IncomingMessage,
  type Is12MethodResult,
  type Is12Notification,
  type NcElementId,
  type NcOid,
  isMethodStatusOk,
} from "./protocol";

export class Is12Error extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "Is12Error";
    this.status = options?.status;
  }
}

export type WebSocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (
    type: string,
    listener: (event: { data?: unknown }) => void,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: { data?: unknown }) => void,
  ) => void;
};

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;
const WS_CONNECTING = 0;

type PendingCommand = {
  resolve: (result: Is12MethodResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type Is12SessionOptions = {
  href: string;
  deviceId: string;
  logger: Logger;
  webSocketFactory?: WebSocketFactory;
  commandTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Called after (re)connect so the orchestrator can re-harvest and re-subscribe. */
  onReady?: (session: Is12Session) => void | Promise<void>;
};

/**
 * Single IS-12 WebSocket session for one device NCP endpoint.
 * At most one session should exist per device.
 */
export class Is12Session extends EventEmitter {
  readonly href: string;
  readonly deviceId: string;

  private readonly logger: Logger;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly commandTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly onReady?: (session: Is12Session) => void | Promise<void>;

  private socket: WebSocketLike | null = null;
  private nextHandle = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private subscribedOids: NcOid[] = [];

  constructor(options: Is12SessionOptions) {
    super();
    this.href = options.href;
    this.deviceId = options.deviceId;
    this.logger = childLogger(options.logger, {
      component: "is12-session",
      deviceId: options.deviceId,
      connectionId: options.href,
    });
    this.webSocketFactory =
      options.webSocketFactory ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.commandTimeoutMs = options.commandTimeoutMs ?? 10_000;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
    this.onReady = options.onReady;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WS_OPEN;
  }

  connect(): void {
    if (this.closed) {
      return;
    }
    this.openSocket();
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.rejectAllPending(new Is12Error("IS-12 session stopped"));
    this.subscribedOids = [];
    this.socket?.close();
    this.socket = null;
  }

  async invoke(
    oid: NcOid,
    methodId: NcElementId,
    args?: Record<string, unknown>,
  ): Promise<Is12MethodResult> {
    const handle = this.nextHandle++;
    const command: Is12Command = {
      handle,
      oid,
      methodId,
      ...(args ? { arguments: args } : {}),
    };

    return this.sendCommands([command]).then((responses) => {
      const response = responses[0];
      if (!response) {
        throw new Is12Error("Empty command response");
      }
      if (!isMethodStatusOk(response.result.status)) {
        throw new Is12Error(
          response.result.errorMessage ??
            `IS-12 method failed with status ${response.result.status}`,
          { status: response.result.status },
        );
      }
      return response.result;
    });
  }

  async getProperty(oid: NcOid, propertyId: NcElementId): Promise<unknown> {
    const result = await this.invoke(oid, METHOD_GET, { id: propertyId });
    return result.value;
  }

  async setProperty(
    oid: NcOid,
    propertyId: NcElementId,
    value: unknown,
  ): Promise<void> {
    await this.invoke(oid, METHOD_SET, { id: propertyId, value });
  }

  /**
   * Replace the session subscription list (IS-12 Subscription message).
   * Previous subscriptions are discarded on reconnect; callers must re-issue.
   */
  async subscribe(oids: NcOid[]): Promise<NcOid[]> {
    this.subscribedOids = [...oids];
    if (!this.isOpen) {
      throw new Is12Error("Cannot subscribe: IS-12 session is not open");
    }

    const message = {
      messageType: MessageType.Subscription,
      subscriptions: oids,
    };

    return new Promise<NcOid[]>((resolve, reject) => {
      const handle = this.nextHandle++;
      // Use a synthetic pending entry keyed by negative handle space for subscription response.
      // Subscription responses have no handle; we track the latest waiter.
      const key = -handle;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Is12Error("IS-12 subscription timed out"));
      }, this.commandTimeoutMs);

      this.pending.set(key, {
        resolve: (result) => {
          resolve((result.value as NcOid[]) ?? []);
        },
        reject,
        timer,
      });

      try {
        this.socket!.send(JSON.stringify(message));
        this.logger.debug({ oids }, "Sent IS-12 subscription");
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(
          new Is12Error("Failed to send IS-12 subscription", { cause: error }),
        );
      }
    });
  }

  private sendCommands(
    commands: Is12Command[],
  ): Promise<Is12CommandResponse[]> {
    if (!this.isOpen) {
      return Promise.reject(
        new Is12Error("Cannot send command: IS-12 session is not open"),
      );
    }

    const message = {
      messageType: MessageType.Command,
      commands,
    };

    return new Promise<Is12CommandResponse[]>((resolve, reject) => {
      const responses: Is12CommandResponse[] = [];
      let remaining = commands.length;

      for (const command of commands) {
        const timer = setTimeout(() => {
          this.pending.delete(command.handle);
          reject(
            new Is12Error(
              `IS-12 command handle ${command.handle} timed out`,
            ),
          );
        }, this.commandTimeoutMs);

        this.pending.set(command.handle, {
          resolve: (result) => {
            responses.push({ handle: command.handle, result });
            remaining -= 1;
            if (remaining === 0) {
              resolve(
                responses.sort((a, b) => a.handle - b.handle),
              );
            }
          },
          reject,
          timer,
        });
      }

      try {
        this.socket!.send(JSON.stringify(message));
        this.logger.debug(
          { handles: commands.map((c) => c.handle) },
          "Sent IS-12 commands",
        );
      } catch (error) {
        for (const command of commands) {
          const pending = this.pending.get(command.handle);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(command.handle);
          }
        }
        reject(
          new Is12Error("Failed to send IS-12 commands", { cause: error }),
        );
      }
    });
  }

  private openSocket(): void {
    if (this.closed) {
      return;
    }

    this.logger.info({ href: this.href }, "Opening IS-12 WebSocket");

    let socket: WebSocketLike;
    try {
      socket = this.webSocketFactory(this.href);
    } catch (error) {
      this.logger.error({ err: error }, "Failed to construct IS-12 WebSocket");
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;

    const onMessage = (event: { data?: unknown }) => {
      try {
        const raw =
          typeof event.data === "string"
            ? JSON.parse(event.data)
            : event.data;
        this.handleIncoming(raw as Is12IncomingMessage);
      } catch (error) {
        this.logger.warn({ err: error }, "Failed to parse IS-12 message");
        this.emit("malformedMessage", error);
      }
    };

    const onClose = () => {
      this.logger.warn("IS-12 WebSocket closed");
      this.rejectAllPending(new Is12Error("IS-12 WebSocket closed"));
      this.subscribedOids = [];
      this.emit("disconnected");
      if (!this.closed) {
        this.scheduleReconnect();
      }
    };

    const onError = () => {
      this.logger.error("IS-12 WebSocket error");
    };

    const onOpen = () => {
      this.reconnectAttempt = 0;
      this.logger.info("IS-12 WebSocket connected");
      this.emit("connected");
      void this.runReadyHook();
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    socket.addEventListener("open", onOpen);

    if (socket.readyState === WS_OPEN) {
      onOpen();
    } else if (socket.readyState !== WS_CONNECTING) {
      // Mock sockets may need an explicit open trigger from tests.
    }
  }

  private async runReadyHook(): Promise<void> {
    if (!this.onReady) {
      return;
    }
    try {
      await this.onReady(this);
      this.emit("ready");
    } catch (error) {
      this.logger.error({ err: error }, "IS-12 onReady hook failed");
      this.emit("readyError", error);
    }
  }

  private handleIncoming(message: Is12IncomingMessage): void {
    switch (message.messageType) {
      case MessageType.CommandResponse: {
        const responses =
          (message as { responses?: Is12CommandResponse[] }).responses ?? [];
        for (const response of responses) {
          const pending = this.pending.get(response.handle);
          if (!pending) {
            this.logger.debug(
              { handle: response.handle },
              "No pending command for response handle",
            );
            continue;
          }
          clearTimeout(pending.timer);
          this.pending.delete(response.handle);
          pending.resolve(response.result);
        }
        break;
      }
      case MessageType.SubscriptionResponse: {
        const subscriptions =
          (message as { subscriptions?: NcOid[] }).subscriptions ?? [];
        // Resolve any subscription waiters (negative keys).
        for (const [key, pending] of this.pending.entries()) {
          if (key < 0) {
            clearTimeout(pending.timer);
            this.pending.delete(key);
            pending.resolve({ status: 200, value: subscriptions });
          }
        }
        this.logger.info(
          { subscriptions },
          "IS-12 subscription response received",
        );
        this.emit("subscribed", subscriptions);
        break;
      }
      case MessageType.Notification: {
        const notifications =
          (message as { notifications?: Is12Notification[] }).notifications ??
          [];
        for (const notification of notifications) {
          this.logger.debug(
            {
              oid: notification.oid,
              propertyId: notification.eventData?.propertyId,
            },
            "IS-12 property notification",
          );
          this.emit("notification", notification);
        }
        break;
      }
      case MessageType.Error: {
        const errorMessage = message as {
          status?: number;
          errorMessage?: string;
        };
        this.logger.error(
          {
            status: errorMessage.status,
            errorMessage: errorMessage.errorMessage,
          },
          "IS-12 protocol error message",
        );
        this.emit("protocolError", errorMessage);
        break;
      }
      default:
        this.logger.warn(
          { messageType: message.messageType },
          "Unhandled IS-12 message type",
        );
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    const attempt = this.reconnectAttempt++;
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** attempt,
      this.reconnectMaxMs,
    );
    this.logger.info(
      { delayMs: delay, attempt: attempt + 1 },
      "Scheduling IS-12 reconnect",
    );
    this.emit("reconnectScheduled", { attempt: attempt + 1, delayMs: delay });
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private rejectAllPending(error: Error): void {
    for (const [handle, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(handle);
    }
  }
}
