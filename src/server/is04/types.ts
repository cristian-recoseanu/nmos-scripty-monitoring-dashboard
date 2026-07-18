/**
 * IS-04 v1.3 resource types — fields needed for harvest, linking, and UI.
 * Full schemas: https://specs.amwa.tv/is-04/releases/v1.3.3/APIs/schemas
 */

export type Uuid = string;

export type ResourceCore = {
  id: Uuid;
  version: string;
  label: string;
  description: string;
  tags?: Record<string, string[]>;
};

export type NmosControl = {
  type: string;
  href: string;
  authorization?: boolean;
};

export type NmosNode = ResourceCore & {
  href: string;
  hostname?: string | null;
  api?: {
    versions?: string[];
    endpoints?: Array<{
      host: string;
      port: number;
      protocol: string;
      authorization?: boolean;
    }>;
  };
  caps?: Record<string, unknown>;
  services?: Array<{
    href: string;
    type: string;
    authorization?: boolean;
  }>;
  clocks?: Array<Record<string, unknown>>;
  interfaces?: Array<Record<string, unknown>>;
};

export type NmosDevice = ResourceCore & {
  type: string;
  node_id: Uuid;
  controls?: NmosControl[];
  /** @deprecated Prefer filtering senders/receivers by device_id. */
  senders?: Uuid[];
  /** @deprecated Prefer filtering senders/receivers by device_id. */
  receivers?: Uuid[];
};

export type NmosSender = ResourceCore & {
  device_id: Uuid;
  flow_id: Uuid | null;
  transport: string;
  interface_bindings?: string[];
  subscription?: {
    receiver_id?: Uuid | null;
    active?: boolean;
  };
  manifest_href?: string | null;
};

export type NmosReceiver = ResourceCore & {
  device_id: Uuid;
  transport: string;
  interface_bindings?: string[];
  subscription: {
    sender_id: Uuid | null;
    active: boolean;
  };
  format?: string;
};

export type NmosFlow = ResourceCore & {
  source_id: Uuid;
  device_id: Uuid;
  format: string;
  parents?: Uuid[];
};

export type NmosSource = ResourceCore & {
  device_id?: Uuid;
  parents?: Uuid[];
  clock_name?: string | null;
  format?: string;
};

export type ResourceType =
  | "node"
  | "device"
  | "sender"
  | "receiver"
  | "flow"
  | "source";

export type ResourcePath =
  | "/nodes"
  | "/devices"
  | "/senders"
  | "/receivers"
  | "/flows"
  | "/sources";

export const RESOURCE_PATHS: readonly ResourcePath[] = [
  "/nodes",
  "/devices",
  "/senders",
  "/receivers",
  "/flows",
  "/sources",
] as const;

export const RESOURCE_PATH_TO_TYPE: Record<ResourcePath, ResourceType> = {
  "/nodes": "node",
  "/devices": "device",
  "/senders": "sender",
  "/receivers": "receiver",
  "/flows": "flow",
  "/sources": "source",
};

export type NmosResource =
  | NmosNode
  | NmosDevice
  | NmosSender
  | NmosReceiver
  | NmosFlow
  | NmosSource;

export const NCP_CONTROL_TYPE_PREFIX = "urn:x-nmos:control:ncp";

export function isNcpControlType(type: string): boolean {
  return type === NCP_CONTROL_TYPE_PREFIX || type.startsWith(`${NCP_CONTROL_TYPE_PREFIX}/`);
}

export function findNcpControl(
  controls: NmosControl[] | undefined,
): NmosControl | undefined {
  return controls?.find((control) => isNcpControlType(control.type));
}
