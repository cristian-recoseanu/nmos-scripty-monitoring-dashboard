import { EventEmitter } from "node:events";

import type { Logger } from "@/server/logging";
import { childLogger } from "@/server/logging";
import {
  isRtpTransport,
  type NmosDevice,
  type NmosReceiver,
  type NmosSender,
  type ResourceStore,
  type ResourceStoreEvent,
  type Uuid,
} from "@/server/is04";

import {
  connectionApiHrefChanged,
  discoverConnectionEndpoint,
} from "./connection-discovery";
import {
  ConnectionApiError,
  ConnectionHttpClient,
} from "./connection-http-client";
import { Is05Cache } from "./is05-cache";
import {
  transportFileFromReceiverActive,
  type Is05CacheEntry,
  type Is05ReceiverActive,
} from "./types";

export type Is05OrchestratorOptions = {
  store: ResourceStore;
  logger: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Max concurrent Connection API harvests. */
  concurrency?: number;
};

type HarvestKey = string;

/**
 * Watches IS-04 sender/receiver version bumps and harvests read-only IS-05
 * `/active` (+ sender `/transportfile`) for RTP resources.
 */
export class Is05Orchestrator extends EventEmitter {
  private readonly store: ResourceStore;
  private readonly logger: Logger;
  private readonly fetchImpl?: typeof fetch;
  private readonly timeoutMs?: number;
  private readonly concurrency: number;
  readonly cache = new Is05Cache();

  private started = false;
  private readonly pending = new Set<HarvestKey>();
  private readonly queued: HarvestKey[] = [];
  private activeCount = 0;
  private readonly clients = new Map<string, ConnectionHttpClient>();

  constructor(options: Is05OrchestratorOptions) {
    super();
    this.store = options.store;
    this.logger = childLogger(options.logger, { component: "is05-orchestrator" });
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs;
    this.concurrency = options.concurrency ?? 4;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    for (const sender of this.store.listSenders()) {
      this.enqueueResource("sender", sender.id, sender, { force: true });
    }
    for (const receiver of this.store.listReceivers()) {
      this.enqueueResource("receiver", receiver.id, receiver, { force: true });
    }

    this.store.on("change", this.onStoreChange);
    this.cache.on("updated", this.onCacheUpdated);
    this.cache.on("removed", this.onCacheRemoved);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.store.off("change", this.onStoreChange);
    this.cache.off("updated", this.onCacheUpdated);
    this.cache.off("removed", this.onCacheRemoved);
    this.pending.clear();
    this.queued.length = 0;
    this.clients.clear();
    this.cache.clear();
  }

  get(resourceId: string): Is05CacheEntry | undefined {
    return this.cache.get(resourceId);
  }

  private onCacheUpdated = (entry: Is05CacheEntry): void => {
    this.emit("updated", entry);
  };

  private onCacheRemoved = (resourceId: string): void => {
    this.emit("removed", resourceId);
  };

  private onStoreChange = (event: ResourceStoreEvent): void => {
    if (!this.started) {
      return;
    }

    if (event.resourceType === "device") {
      if (event.type === "resource.removed") {
        this.cache.clearDevice(event.id);
        this.clients.delete(event.id);
        return;
      }
      const device = event.resource as NmosDevice;
      const previous =
        event.type === "resource.updated"
          ? (event.previous as NmosDevice | undefined)
          : undefined;
      if (connectionApiHrefChanged(previous, device)) {
        this.logger.info(
          { deviceId: device.id, href: discoverConnectionEndpoint(device).href },
          "IS-05 Connection API href changed; re-harvesting children",
        );
        this.clients.delete(device.id);
        this.cache.clearDevice(device.id);
        for (const sender of this.store.listSenders()) {
          if (sender.device_id === device.id) {
            this.enqueueResource("sender", sender.id, sender, { force: true });
          }
        }
        for (const receiver of this.store.listReceivers()) {
          if (receiver.device_id === device.id) {
            this.enqueueResource("receiver", receiver.id, receiver, {
              force: true,
            });
          }
        }
      }
      return;
    }

    if (event.resourceType === "sender") {
      if (event.type === "resource.removed") {
        this.cache.delete(event.id);
        return;
      }
      const resource = event.resource as NmosSender;
      const previous =
        event.type === "resource.updated"
          ? (event.previous as NmosSender | undefined)
          : undefined;
      const versionChanged = previous?.version !== resource.version;
      this.enqueueResource("sender", resource.id, resource, {
        force: event.type === "resource.added" || versionChanged,
      });
      return;
    }

    if (event.resourceType === "receiver") {
      if (event.type === "resource.removed") {
        this.cache.delete(event.id);
        return;
      }
      const resource = event.resource as NmosReceiver;
      const previous =
        event.type === "resource.updated"
          ? (event.previous as NmosReceiver | undefined)
          : undefined;
      const versionChanged = previous?.version !== resource.version;
      this.enqueueResource("receiver", resource.id, resource, {
        force: event.type === "resource.added" || versionChanged,
      });
    }
  };

  private enqueueResource(
    resourceType: "sender" | "receiver",
    resourceId: Uuid,
    resource: NmosSender | NmosReceiver,
    options: { force: boolean },
  ): void {
    if (!options.force) {
      return;
    }

    if (!isRtpTransport(resource.transport)) {
      this.logger.debug(
        { resourceId, transport: resource.transport },
        "Skipping IS-05 harvest for non-RTP transport",
      );
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "skipped",
        sourceIs04Version: resource.version,
        error: `Transport ${resource.transport} is outside Phase 7 RTP scope`,
      });
      return;
    }

    const device = this.store.getDevice(resource.device_id);
    if (!device) {
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "unavailable",
        sourceIs04Version: resource.version,
        error: "Parent device not found in store",
      });
      return;
    }

    const endpoint = discoverConnectionEndpoint(device);
    if (endpoint.availability !== "available" || !endpoint.href) {
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "unavailable",
        connectionApiHref: endpoint.href,
        sourceIs04Version: resource.version,
        error: "Device has no usable urn:x-nmos:control:sr-ctrl endpoint",
      });
      return;
    }

    if (endpoint.ambiguous) {
      this.logger.warn(
        { deviceId: device.id, href: endpoint.href, controlType: endpoint.controlType },
        "Multiple sr-ctrl controls; preferred one aligned with href version",
      );
    }

    const existing = this.cache.get(resourceId);
    if (!existing || existing.status !== "available") {
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "pending",
        connectionApiHref: endpoint.href,
        sourceIs04Version: resource.version,
        active: existing?.active,
        transportFile: existing?.transportFile,
        fetchedAt: existing?.fetchedAt,
      });
    }

    const key = `${resourceType}:${resourceId}`;
    if (this.pending.has(key)) {
      return;
    }
    this.pending.add(key);
    this.queued.push(key);
    this.logger.debug(
      { resourceId, resourceType, deviceId: resource.device_id },
      "Enqueued IS-05 harvest",
    );
    this.pump();
  }

  private pump(): void {
    while (this.activeCount < this.concurrency && this.queued.length > 0) {
      const key = this.queued.shift();
      if (!key) {
        break;
      }
      this.activeCount += 1;
      void this.runHarvest(key).finally(() => {
        this.activeCount -= 1;
        this.pending.delete(key);
        this.pump();
      });
    }
  }

  private async runHarvest(key: HarvestKey): Promise<void> {
    const colon = key.indexOf(":");
    const resourceType = key.slice(0, colon) as "sender" | "receiver";
    const resourceId = key.slice(colon + 1);
    const resource =
      resourceType === "sender"
        ? this.store.getSender(resourceId)
        : this.store.getReceiver(resourceId);
    if (!resource) {
      this.cache.delete(resourceId);
      return;
    }

    const device = this.store.getDevice(resource.device_id);
    if (!device) {
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "unavailable",
        sourceIs04Version: resource.version,
        error: "Parent device not found in store",
      });
      return;
    }

    const endpoint = discoverConnectionEndpoint(device);
    if (endpoint.availability !== "available" || !endpoint.href) {
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "unavailable",
        connectionApiHref: endpoint.href,
        sourceIs04Version: resource.version,
        error: "Device has no usable urn:x-nmos:control:sr-ctrl endpoint",
      });
      return;
    }

    try {
      const client = this.clientFor(device.id, endpoint.href);
      if (resourceType === "sender") {
        const active = await client.getSenderActive(resourceId);
        let transportFile: Is05CacheEntry["transportFile"] = null;
        try {
          transportFile = await client.getSenderTransportFile(resourceId);
        } catch (error) {
          if (
            !(error instanceof ConnectionApiError && error.status === 404)
          ) {
            throw error;
          }
          transportFile = null;
        }
        this.cache.set({
          resourceType,
          resourceId,
          deviceId: resource.device_id,
          status: "available",
          connectionApiHref: endpoint.href,
          active,
          transportFile,
          fetchedAt: Date.now(),
          sourceIs04Version: resource.version,
        });
      } else {
        const active = await client.getReceiverActive(resourceId);
        this.cache.set({
          resourceType,
          resourceId,
          deviceId: resource.device_id,
          status: "available",
          connectionApiHref: endpoint.href,
          active,
          transportFile: transportFileFromReceiverActive(
            active as Is05ReceiverActive,
          ),
          fetchedAt: Date.now(),
          sourceIs04Version: resource.version,
        });
      }

      this.logger.info(
        {
          resourceId,
          resourceType,
          deviceId: resource.device_id,
          version: resource.version,
        },
        "IS-05 harvest succeeded",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "IS-05 harvest failed";
      const status =
        error instanceof ConnectionApiError ? error.status : undefined;
      this.logger.error(
        { err: error, resourceId, resourceType, status },
        "IS-05 harvest failed",
      );
      this.cache.set({
        resourceType,
        resourceId,
        deviceId: resource.device_id,
        status: "error",
        connectionApiHref: endpoint.href,
        sourceIs04Version: resource.version,
        error: message,
        active: this.cache.get(resourceId)?.active,
        transportFile: this.cache.get(resourceId)?.transportFile,
        fetchedAt: this.cache.get(resourceId)?.fetchedAt,
      });
    }
  }

  private clientFor(deviceId: Uuid, href: string): ConnectionHttpClient {
    const existing = this.clients.get(deviceId);
    if (existing && existing.getBaseUrl() === href.replace(/\/$/, "")) {
      return existing;
    }
    const client = new ConnectionHttpClient({
      baseUrl: href,
      logger: this.logger,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    this.clients.set(deviceId, client);
    return client;
  }
}
