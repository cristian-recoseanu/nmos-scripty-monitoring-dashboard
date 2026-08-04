import {
  listNcpControls,
  type NmosControl,
  type NmosDevice,
} from "@/server/is04";

export type NcpAvailability = "available" | "unavailable";

export type NcpControlCandidate = {
  href: string;
  controlType: string;
};

export type NcpEndpoint = {
  availability: NcpAvailability;
  /** Preferred / first reachable-candidate href (ws/wss). */
  href?: string;
  controlType?: string;
  /**
   * Ordered reachable-scheme candidates to try until one connects.
   * Empty when no usable NCP control is advertised.
   */
  candidates: NcpControlCandidate[];
};

/**
 * Discover the IS-12 NCP WebSocket endpoint(s) from an IS-04 device controls array.
 */
export function discoverNcpEndpoint(device: NmosDevice): NcpEndpoint {
  return discoverNcpFromControls(device.controls);
}

export function discoverNcpFromControls(
  controls: NmosControl[] | undefined,
): NcpEndpoint {
  const listed = listNcpControls(controls);
  if (listed.length === 0) {
    return { availability: "unavailable", candidates: [] };
  }

  const candidates: NcpControlCandidate[] = [];
  for (const control of listed) {
    if (
      control.href.startsWith("ws://") ||
      control.href.startsWith("wss://")
    ) {
      candidates.push({ href: control.href, controlType: control.type });
    }
  }

  if (candidates.length === 0) {
    const first = listed[0];
    return {
      availability: "unavailable",
      href: first?.href,
      controlType: first?.type,
      candidates: [],
    };
  }

  return {
    availability: "available",
    href: candidates[0]!.href,
    controlType: candidates[0]!.controlType,
    candidates,
  };
}

/** True when the set of usable NCP candidate hrefs changed. */
export function ncpHrefChanged(
  previous: NmosDevice | undefined,
  next: NmosDevice,
): boolean {
  const prevHrefs = discoverNcpEndpoint(previous ?? { ...next, controls: [] })
    .candidates.map((c) => c.href)
    .join("\0");
  const nextHrefs = discoverNcpEndpoint(next)
    .candidates.map((c) => c.href)
    .join("\0");
  return prevHrefs !== nextHrefs;
}
