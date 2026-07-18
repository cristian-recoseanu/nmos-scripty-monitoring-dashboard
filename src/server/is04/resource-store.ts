import { EventEmitter } from "node:events";

import type { HealthSeverity } from "@/lib/health";

import type { ParsedGrainEvent } from "./grains";
import type {
  NmosDevice,
  NmosFlow,
  NmosNode,
  NmosReceiver,
  NmosResource,
  NmosSender,
  NmosSource,
  ResourcePath,
  ResourceType,
  Uuid,
} from "./types";
import { RESOURCE_PATH_TO_TYPE } from "./types";

export type StoredResource<T extends NmosResource = NmosResource> = {
  type: ResourceType;
  resource: T;
  firstSeen: number;
  lastUpdated: number;
};

export type ResourceStoreEvent =
  | {
      type: "resource.added";
      resourceType: ResourceType;
      id: Uuid;
      resource: NmosResource;
    }
  | {
      type: "resource.updated";
      resourceType: ResourceType;
      id: Uuid;
      resource: NmosResource;
      previous: NmosResource;
    }
  | {
      type: "resource.removed";
      resourceType: ResourceType;
      id: Uuid;
      resource: NmosResource;
    };

type MonitorBinding = {
  deviceId: Uuid;
  monitorOid: number;
  overallStatus?: string;
  health: HealthSeverity;
};

/**
 * In-memory IS-04 resource store with indexes and lifecycle events.
 */
export class ResourceStore extends EventEmitter {
  private readonly nodes = new Map<Uuid, StoredResource<NmosNode>>();
  private readonly devices = new Map<Uuid, StoredResource<NmosDevice>>();
  private readonly senders = new Map<Uuid, StoredResource<NmosSender>>();
  private readonly receivers = new Map<Uuid, StoredResource<NmosReceiver>>();
  private readonly flows = new Map<Uuid, StoredResource<NmosFlow>>();
  private readonly sources = new Map<Uuid, StoredResource<NmosSource>>();

  private readonly devicesByNodeId = new Map<Uuid, Set<Uuid>>();
  private readonly sendersByDeviceId = new Map<Uuid, Set<Uuid>>();
  private readonly receiversByDeviceId = new Map<Uuid, Set<Uuid>>();

  /** IS-04 resource id → monitor binding (populated by IS-12 layer). */
  private readonly monitorByResourceId = new Map<Uuid, MonitorBinding>();

  applyGrains(events: ParsedGrainEvent[], fallbackPath?: ResourcePath): void {
    for (const event of events) {
      const path = event.resourcePath ?? fallbackPath;
      if (!path) {
        continue;
      }
      const resourceType = RESOURCE_PATH_TO_TYPE[path];
      this.applyEvent(resourceType, event);
    }
  }

  private applyEvent(
    resourceType: ResourceType,
    event: ParsedGrainEvent,
  ): void {
    const now = Date.now();

    if (event.kind === "removed") {
      const previous = this.getRaw(resourceType, event.resourceId);
      if (!previous) {
        return;
      }
      this.deleteResource(resourceType, event.resourceId);
      this.emit("change", {
        type: "resource.removed",
        resourceType,
        id: event.resourceId,
        resource: previous,
      } satisfies ResourceStoreEvent);
      return;
    }

    const payload = event.post;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const resource = payload as NmosResource;
    const existing = this.getStored(resourceType, event.resourceId);

    if (!existing) {
      this.putResource(resourceType, resource, now, now);
      this.emit("change", {
        type: "resource.added",
        resourceType,
        id: event.resourceId,
        resource,
      } satisfies ResourceStoreEvent);
      return;
    }

    // sync or modified
    this.putResource(resourceType, resource, existing.firstSeen, now);
    if (event.kind === "modified") {
      this.emit("change", {
        type: "resource.updated",
        resourceType,
        id: event.resourceId,
        resource,
        previous: existing.resource,
      } satisfies ResourceStoreEvent);
    }
  }

  upsert(resourceType: ResourceType, resource: NmosResource): void {
    const now = Date.now();
    const existing = this.getStored(resourceType, resource.id);
    if (!existing) {
      this.putResource(resourceType, resource, now, now);
      this.emit("change", {
        type: "resource.added",
        resourceType,
        id: resource.id,
        resource,
      } satisfies ResourceStoreEvent);
      return;
    }

    this.putResource(resourceType, resource, existing.firstSeen, now);
    this.emit("change", {
      type: "resource.updated",
      resourceType,
      id: resource.id,
      resource,
      previous: existing.resource,
    } satisfies ResourceStoreEvent);
  }

  remove(resourceType: ResourceType, id: Uuid): void {
    const previous = this.getRaw(resourceType, id);
    if (!previous) {
      return;
    }
    this.deleteResource(resourceType, id);
    this.emit("change", {
      type: "resource.removed",
      resourceType,
      id,
      resource: previous,
    } satisfies ResourceStoreEvent);
  }

  getNode(id: Uuid): NmosNode | undefined {
    return this.nodes.get(id)?.resource;
  }

  getDevice(id: Uuid): NmosDevice | undefined {
    return this.devices.get(id)?.resource;
  }

  getSender(id: Uuid): NmosSender | undefined {
    return this.senders.get(id)?.resource;
  }

  getReceiver(id: Uuid): NmosReceiver | undefined {
    return this.receivers.get(id)?.resource;
  }

  getFlow(id: Uuid): NmosFlow | undefined {
    return this.flows.get(id)?.resource;
  }

  getSource(id: Uuid): NmosSource | undefined {
    return this.sources.get(id)?.resource;
  }

  listNodes(): NmosNode[] {
    return [...this.nodes.values()].map((entry) => entry.resource);
  }

  listDevices(): NmosDevice[] {
    return [...this.devices.values()].map((entry) => entry.resource);
  }

  listSenders(): NmosSender[] {
    return [...this.senders.values()].map((entry) => entry.resource);
  }

  listReceivers(): NmosReceiver[] {
    return [...this.receivers.values()].map((entry) => entry.resource);
  }

  listFlows(): NmosFlow[] {
    return [...this.flows.values()].map((entry) => entry.resource);
  }

  listSources(): NmosSource[] {
    return [...this.sources.values()].map((entry) => entry.resource);
  }

  getDevicesForNode(nodeId: Uuid): NmosDevice[] {
    const ids = this.devicesByNodeId.get(nodeId);
    if (!ids) {
      return [];
    }
    return [...ids]
      .map((id) => this.devices.get(id)?.resource)
      .filter((device): device is NmosDevice => device !== undefined);
  }

  getSendersForDevice(deviceId: Uuid): NmosSender[] {
    const ids = this.sendersByDeviceId.get(deviceId);
    if (!ids) {
      return [];
    }
    return [...ids]
      .map((id) => this.senders.get(id)?.resource)
      .filter((sender): sender is NmosSender => sender !== undefined);
  }

  getReceiversForDevice(deviceId: Uuid): NmosReceiver[] {
    const ids = this.receiversByDeviceId.get(deviceId);
    if (!ids) {
      return [];
    }
    return [...ids]
      .map((id) => this.receivers.get(id)?.resource)
      .filter((receiver): receiver is NmosReceiver => receiver !== undefined);
  }

  /**
   * Resolve the sender connected to a receiver via subscription.sender_id.
   */
  getConnectedSender(receiverId: Uuid): NmosSender | undefined {
    const receiver = this.receivers.get(receiverId)?.resource;
    if (!receiver?.subscription?.active || !receiver.subscription.sender_id) {
      return undefined;
    }
    return this.senders.get(receiver.subscription.sender_id)?.resource;
  }

  resolveSenderFlowAndSource(senderId: Uuid): {
    sender: NmosSender;
    flow?: NmosFlow;
    source?: NmosSource;
  } | undefined {
    const sender = this.senders.get(senderId)?.resource;
    if (!sender) {
      return undefined;
    }
    const flow = sender.flow_id
      ? this.flows.get(sender.flow_id)?.resource
      : undefined;
    const source = flow
      ? this.sources.get(flow.source_id)?.resource
      : undefined;
    return { sender, flow, source };
  }

  setMonitorBinding(resourceId: Uuid, binding: MonitorBinding | undefined): void {
    if (!binding) {
      this.monitorByResourceId.delete(resourceId);
      return;
    }
    this.monitorByResourceId.set(resourceId, binding);
  }

  getMonitorBinding(resourceId: Uuid): MonitorBinding | undefined {
    return this.monitorByResourceId.get(resourceId);
  }

  clear(): void {
    this.nodes.clear();
    this.devices.clear();
    this.senders.clear();
    this.receivers.clear();
    this.flows.clear();
    this.sources.clear();
    this.devicesByNodeId.clear();
    this.sendersByDeviceId.clear();
    this.receiversByDeviceId.clear();
    this.monitorByResourceId.clear();
  }

  private getRaw(
    resourceType: ResourceType,
    id: Uuid,
  ): NmosResource | undefined {
    return this.getStored(resourceType, id)?.resource;
  }

  private getStored(
    resourceType: ResourceType,
    id: Uuid,
  ): StoredResource | undefined {
    switch (resourceType) {
      case "node":
        return this.nodes.get(id);
      case "device":
        return this.devices.get(id);
      case "sender":
        return this.senders.get(id);
      case "receiver":
        return this.receivers.get(id);
      case "flow":
        return this.flows.get(id);
      case "source":
        return this.sources.get(id);
    }
  }

  private putResource(
    resourceType: ResourceType,
    resource: NmosResource,
    firstSeen: number,
    lastUpdated: number,
  ): void {
    const stored = { type: resourceType, resource, firstSeen, lastUpdated };

    switch (resourceType) {
      case "node":
        this.nodes.set(resource.id, stored as StoredResource<NmosNode>);
        break;
      case "device": {
        const device = resource as NmosDevice;
        const previous = this.devices.get(device.id)?.resource;
        if (previous) {
          this.removeFromIndex(this.devicesByNodeId, previous.node_id, device.id);
        }
        this.devices.set(device.id, stored as StoredResource<NmosDevice>);
        this.addToIndex(this.devicesByNodeId, device.node_id, device.id);
        break;
      }
      case "sender": {
        const sender = resource as NmosSender;
        const previous = this.senders.get(sender.id)?.resource;
        if (previous) {
          this.removeFromIndex(
            this.sendersByDeviceId,
            previous.device_id,
            sender.id,
          );
        }
        this.senders.set(sender.id, stored as StoredResource<NmosSender>);
        this.addToIndex(this.sendersByDeviceId, sender.device_id, sender.id);
        break;
      }
      case "receiver": {
        const receiver = resource as NmosReceiver;
        const previous = this.receivers.get(receiver.id)?.resource;
        if (previous) {
          this.removeFromIndex(
            this.receiversByDeviceId,
            previous.device_id,
            receiver.id,
          );
        }
        this.receivers.set(receiver.id, stored as StoredResource<NmosReceiver>);
        this.addToIndex(
          this.receiversByDeviceId,
          receiver.device_id,
          receiver.id,
        );
        break;
      }
      case "flow":
        this.flows.set(resource.id, stored as StoredResource<NmosFlow>);
        break;
      case "source":
        this.sources.set(resource.id, stored as StoredResource<NmosSource>);
        break;
    }
  }

  private deleteResource(resourceType: ResourceType, id: Uuid): void {
    switch (resourceType) {
      case "node":
        this.nodes.delete(id);
        break;
      case "device": {
        const device = this.devices.get(id)?.resource;
        if (device) {
          this.removeFromIndex(this.devicesByNodeId, device.node_id, id);
        }
        this.devices.delete(id);
        break;
      }
      case "sender": {
        const sender = this.senders.get(id)?.resource;
        if (sender) {
          this.removeFromIndex(this.sendersByDeviceId, sender.device_id, id);
        }
        this.senders.delete(id);
        this.monitorByResourceId.delete(id);
        break;
      }
      case "receiver": {
        const receiver = this.receivers.get(id)?.resource;
        if (receiver) {
          this.removeFromIndex(
            this.receiversByDeviceId,
            receiver.device_id,
            id,
          );
        }
        this.receivers.delete(id);
        this.monitorByResourceId.delete(id);
        break;
      }
      case "flow":
        this.flows.delete(id);
        break;
      case "source":
        this.sources.delete(id);
        break;
    }
  }

  private addToIndex(
    index: Map<Uuid, Set<Uuid>>,
    parentId: Uuid,
    childId: Uuid,
  ): void {
    let set = index.get(parentId);
    if (!set) {
      set = new Set();
      index.set(parentId, set);
    }
    set.add(childId);
  }

  private removeFromIndex(
    index: Map<Uuid, Set<Uuid>>,
    parentId: Uuid,
    childId: Uuid,
  ): void {
    const set = index.get(parentId);
    if (!set) {
      return;
    }
    set.delete(childId);
    if (set.size === 0) {
      index.delete(parentId);
    }
  }
}
