import {
  findSrCtrlControl,
  type NmosControl,
  type NmosDevice,
} from "@/server/is04";

export type ConnectionApiAvailability = "available" | "unavailable";

export type ConnectionApiEndpoint = {
  availability: ConnectionApiAvailability;
  href?: string;
  controlType?: string;
  /** True when multiple sr-ctrl controls were present and one was preferred. */
  ambiguous?: boolean;
};

/**
 * Discover the IS-05 Connection API base URL from an IS-04 device controls array.
 */
export function discoverConnectionEndpoint(
  device: NmosDevice,
): ConnectionApiEndpoint {
  return discoverConnectionFromControls(device.controls);
}

export function discoverConnectionFromControls(
  controls: NmosControl[] | undefined,
): ConnectionApiEndpoint {
  const matches =
    controls?.filter((control) =>
      control.type === "urn:x-nmos:control:sr-ctrl" ||
      control.type.startsWith("urn:x-nmos:control:sr-ctrl/"),
    ) ?? [];
  const control = findSrCtrlControl(controls);
  if (!control?.href) {
    return { availability: "unavailable" };
  }

  if (
    !control.href.startsWith("http://") &&
    !control.href.startsWith("https://")
  ) {
    return {
      availability: "unavailable",
      href: control.href,
      controlType: control.type,
      ambiguous: matches.length > 1,
    };
  }

  return {
    availability: "available",
    href: control.href.replace(/\/?$/, "/"),
    controlType: control.type,
    ambiguous: matches.length > 1,
  };
}

export function connectionApiHrefChanged(
  previous: NmosDevice | undefined,
  next: NmosDevice,
): boolean {
  const prevHref = discoverConnectionEndpoint(
    previous ?? { ...next, controls: [] },
  ).href;
  const nextHref = discoverConnectionEndpoint(next).href;
  return prevHref !== nextHref;
}
