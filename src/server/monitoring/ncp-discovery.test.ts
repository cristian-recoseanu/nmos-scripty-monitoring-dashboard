import { describe, expect, it } from "vitest";

import {
  detectMonitorKind,
  discoverNcpEndpoint,
  ncpHrefChanged,
  overallStatusName,
  parseMonitorTouchpoint,
  TouchpointError,
} from "@/server/monitoring";
import type { NmosDevice } from "@/server/is04";

describe("discoverNcpEndpoint", () => {
  it("finds versioned ncp controls", () => {
    const device = {
      id: "d1",
      version: "1:0",
      label: "D",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "n1",
      controls: [
        {
          type: "urn:x-nmos:control:ncp/v1.0",
          href: "ws://127.0.0.1:8080/x-nmos/ncp/v1.0/connect",
        },
      ],
    } satisfies NmosDevice;

    expect(discoverNcpEndpoint(device)).toEqual({
      availability: "available",
      href: "ws://127.0.0.1:8080/x-nmos/ncp/v1.0/connect",
      controlType: "urn:x-nmos:control:ncp/v1.0",
    });
  });

  it("marks devices without ncp as unavailable", () => {
    expect(
      discoverNcpEndpoint({
        id: "d1",
        version: "1:0",
        label: "D",
        description: "",
        type: "urn:x-nmos:device:generic",
        node_id: "n1",
        controls: [
          { type: "urn:x-nmos:control:sr-ctrl/v1.1", href: "http://x" },
        ],
      }),
    ).toEqual({ availability: "unavailable" });
  });

  it("rejects non-websocket ncp hrefs", () => {
    expect(
      discoverNcpEndpoint({
        id: "d1",
        version: "1:0",
        label: "D",
        description: "",
        type: "urn:x-nmos:device:generic",
        node_id: "n1",
        controls: [
          { type: "urn:x-nmos:control:ncp/v1.0", href: "http://not-ws" },
        ],
      }),
    ).toMatchObject({ availability: "unavailable", href: "http://not-ws" });
  });

  it("detects href changes", () => {
    const a: NmosDevice = {
      id: "d1",
      version: "1:0",
      label: "D",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "n1",
      controls: [
        { type: "urn:x-nmos:control:ncp/v1.0", href: "ws://a" },
      ],
    };
    const b = {
      ...a,
      controls: [{ type: "urn:x-nmos:control:ncp/v1.0", href: "ws://b" }],
    };
    expect(ncpHrefChanged(a, b)).toBe(true);
    expect(ncpHrefChanged(a, a)).toBe(false);
  });
});

describe("detectMonitorKind / overallStatusName", () => {
  it("detects receiver and sender monitors including derived class ids", () => {
    expect(detectMonitorKind([1, 2, 2, 1])).toBe("receiver");
    expect(detectMonitorKind([1, 2, 2, 1, 9])).toBe("receiver");
    expect(detectMonitorKind([1, 2, 2, 2])).toBe("sender");
    expect(detectMonitorKind([1, 2, 2])).toBeUndefined();
    expect(detectMonitorKind([1, 1])).toBeUndefined();
  });

  it("maps overall status enums to names", () => {
    expect(overallStatusName(0)).toBe("Inactive");
    expect(overallStatusName(1)).toBe("Healthy");
    expect(overallStatusName(2)).toBe("PartiallyHealthy");
    expect(overallStatusName(3)).toBe("Unhealthy");
    expect(overallStatusName("Healthy")).toBe("Healthy");
    expect(overallStatusName(99)).toBeUndefined();
  });
});

describe("parseMonitorTouchpoint", () => {
  it("parses a valid NMOS receiver touchpoint", () => {
    expect(
      parseMonitorTouchpoint(
        [
          {
            contextNamespace: "x-nmos",
            resource: {
              resourceType: "receiver",
              id: "82fdc03f-76c7-4989-9d05-3ea2cc98875e",
            },
          },
        ],
        "receiver",
      ),
    ).toEqual({
      resourceType: "receiver",
      resourceId: "82fdc03f-76c7-4989-9d05-3ea2cc98875e",
    });
  });

  it("rejects missing / wrong touchpoints", () => {
    expect(() => parseMonitorTouchpoint([])).toThrow(TouchpointError);
    expect(() =>
      parseMonitorTouchpoint([
        {
          contextNamespace: "other",
          resource: { resourceType: "receiver", id: "x" },
        },
      ]),
    ).toThrow(/no x-nmos/);
    expect(() =>
      parseMonitorTouchpoint(
        [
          {
            contextNamespace: "x-nmos",
            resource: { resourceType: "sender", id: "x" },
          },
        ],
        "receiver",
      ),
    ).toThrow(/receiver/);
  });
});
