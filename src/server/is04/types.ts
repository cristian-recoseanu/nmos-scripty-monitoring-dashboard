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
export const SR_CTRL_CONTROL_TYPE_PREFIX = "urn:x-nmos:control:sr-ctrl";
export const RTP_TRANSPORT_PREFIX = "urn:x-nmos:transport:rtp";

export function isNcpControlType(type: string): boolean {
  return type === NCP_CONTROL_TYPE_PREFIX || type.startsWith(`${NCP_CONTROL_TYPE_PREFIX}/`);
}

export function isSrCtrlControlType(type: string): boolean {
  return (
    type === SR_CTRL_CONTROL_TYPE_PREFIX ||
    type.startsWith(`${SR_CTRL_CONTROL_TYPE_PREFIX}/`)
  );
}

export function isRtpTransport(transport: string): boolean {
  return (
    transport === RTP_TRANSPORT_PREFIX ||
    transport.startsWith(`${RTP_TRANSPORT_PREFIX}.`) ||
    transport.startsWith(`${RTP_TRANSPORT_PREFIX}/`)
  );
}

export function findNcpControl(
  controls: NmosControl[] | undefined,
): NmosControl | undefined {
  return listNcpControls(controls)[0];
}

/**
 * All NCP controls in advertisement order, de-duplicated by href.
 * Callers that need reachability failover should try these in order.
 */
export function listNcpControls(
  controls: NmosControl[] | undefined,
): NmosControl[] {
  if (!controls?.length) {
    return [];
  }
  const seen = new Set<string>();
  const listed: NmosControl[] = [];
  for (const control of controls) {
    if (!isNcpControlType(control.type) || !control.href) {
      continue;
    }
    if (seen.has(control.href)) {
      continue;
    }
    seen.add(control.href);
    listed.push(control);
  }
  return listed;
}

/**
 * Prefer the `sr-ctrl` control whose type version aligns with the href path
 * (e.g. `…/v1.1` and `…/connection/v1.1/`). When several align, prefer the
 * highest version. Falls back to the first match.
 */
export function findSrCtrlControl(
  controls: NmosControl[] | undefined,
): NmosControl | undefined {
  return listSrCtrlControls(controls)[0];
}

/**
 * Ordered `sr-ctrl` controls for failover: version-aligned first (highest
 * version first within each group), then remaining matches. De-duplicated by
 * normalised href.
 */
export function listSrCtrlControls(
  controls: NmosControl[] | undefined,
): NmosControl[] {
  const matches =
    controls?.filter(
      (control) => isSrCtrlControlType(control.type) && Boolean(control.href),
    ) ?? [];
  if (matches.length <= 1) {
    return matches;
  }

  const aligned = matches.filter((control) => {
    const typeVersion = controlTypeVersion(control.type);
    const hrefVersion = hrefPathVersion(control.href);
    return typeVersion && hrefVersion && typeVersion === hrefVersion;
  });
  const unaligned = matches.filter((control) => !aligned.includes(control));

  const byVersionDesc = (a: NmosControl, b: NmosControl): number =>
    compareVersions(controlTypeVersion(b.type), controlTypeVersion(a.type));

  const ordered = [
    ...[...aligned].sort(byVersionDesc),
    ...[...unaligned].sort(byVersionDesc),
  ];

  const seen = new Set<string>();
  const listed: NmosControl[] = [];
  for (const control of ordered) {
    const key = control.href.replace(/\/?$/, "/");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    listed.push(control);
  }
  return listed;
}

function controlTypeVersion(type: string): string | undefined {
  const match = /\/(v\d+(?:\.\d+)*)$/i.exec(type);
  return match?.[1]?.toLowerCase();
}

function hrefPathVersion(href: string): string | undefined {
  const match = /\/(v\d+(?:\.\d+)*)(?:\/|$)/i.exec(href);
  return match?.[1]?.toLowerCase();
}

/** Compare `v1.1` style versions; positive if a > b. */
function compareVersions(a: string | undefined, b: string | undefined): number {
  const parse = (value: string | undefined): number[] => {
    if (!value) {
      return [];
    }
    return value
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  };
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
