import {
  listSrCtrlControls,
  type NmosControl,
  type NmosDevice,
} from "@/server/is04";

export type ConnectionApiAvailability = "available" | "unavailable";

export type ConnectionApiCandidate = {
  href: string;
  controlType: string;
};

export type ConnectionApiEndpoint = {
  availability: ConnectionApiAvailability;
  /** Preferred / first http(s) candidate. */
  href?: string;
  controlType?: string;
  /** True when more than one sr-ctrl control was advertised. */
  ambiguous?: boolean;
  /**
   * Ordered http(s) candidates to try until a harvest succeeds.
   * Empty when no usable Connection API control is advertised.
   */
  candidates: ConnectionApiCandidate[];
};

/**
 * Discover the IS-05 Connection API base URL(s) from an IS-04 device controls array.
 */
export function discoverConnectionEndpoint(
  device: NmosDevice,
): ConnectionApiEndpoint {
  return discoverConnectionFromControls(device.controls);
}

export function discoverConnectionFromControls(
  controls: NmosControl[] | undefined,
): ConnectionApiEndpoint {
  const listed = listSrCtrlControls(controls);
  if (listed.length === 0) {
    return { availability: "unavailable", candidates: [] };
  }

  const candidates: ConnectionApiCandidate[] = [];
  for (const control of listed) {
    if (
      control.href.startsWith("http://") ||
      control.href.startsWith("https://")
    ) {
      candidates.push({
        href: control.href.replace(/\/?$/, "/"),
        controlType: control.type,
      });
    }
  }

  if (candidates.length === 0) {
    const first = listed[0];
    return {
      availability: "unavailable",
      href: first?.href,
      controlType: first?.type,
      ambiguous: listed.length > 1,
      candidates: [],
    };
  }

  return {
    availability: "available",
    href: candidates[0]!.href,
    controlType: candidates[0]!.controlType,
    ambiguous: listed.length > 1,
    candidates,
  };
}

/** True when the set of usable Connection API candidate hrefs changed. */
export function connectionApiHrefChanged(
  previous: NmosDevice | undefined,
  next: NmosDevice,
): boolean {
  const prevHrefs = discoverConnectionEndpoint(
    previous ?? { ...next, controls: [] },
  )
    .candidates.map((c) => c.href)
    .join("\0");
  const nextHrefs = discoverConnectionEndpoint(next)
    .candidates.map((c) => c.href)
    .join("\0");
  return prevHrefs !== nextHrefs;
}
