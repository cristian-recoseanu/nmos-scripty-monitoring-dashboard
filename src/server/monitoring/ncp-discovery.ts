import {
  findNcpControl,
  type NmosControl,
  type NmosDevice,
} from "@/server/is04";

export type NcpAvailability = "available" | "unavailable";

export type NcpEndpoint = {
  availability: NcpAvailability;
  href?: string;
  controlType?: string;
};

/**
 * Discover the IS-12 NCP WebSocket endpoint from an IS-04 device controls array.
 */
export function discoverNcpEndpoint(device: NmosDevice): NcpEndpoint {
  return discoverNcpFromControls(device.controls);
}

export function discoverNcpFromControls(
  controls: NmosControl[] | undefined,
): NcpEndpoint {
  const control = findNcpControl(controls);
  if (!control?.href) {
    return { availability: "unavailable" };
  }

  if (!control.href.startsWith("ws://") && !control.href.startsWith("wss://")) {
    return {
      availability: "unavailable",
      href: control.href,
      controlType: control.type,
    };
  }

  return {
    availability: "available",
    href: control.href,
    controlType: control.type,
  };
}

export function ncpHrefChanged(
  previous: NmosDevice | undefined,
  next: NmosDevice,
): boolean {
  const prevHref = discoverNcpEndpoint(previous ?? { ...next, controls: [] })
    .href;
  const nextHref = discoverNcpEndpoint(next).href;
  return prevHref !== nextHref;
}
