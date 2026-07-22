import { describe, expect, it } from "vitest";

import {
  findSrCtrlControl,
  isRtpTransport,
  isSrCtrlControlType,
  type NmosDevice,
} from "@/server/is04";
import {
  connectionApiHrefChanged,
  discoverConnectionEndpoint,
} from "@/server/is05";

describe("isSrCtrlControlType / findSrCtrlControl", () => {
  it("matches versioned sr-ctrl types", () => {
    expect(isSrCtrlControlType("urn:x-nmos:control:sr-ctrl")).toBe(true);
    expect(isSrCtrlControlType("urn:x-nmos:control:sr-ctrl/v1.1")).toBe(true);
    expect(isSrCtrlControlType("urn:x-nmos:control:ncp/v1.0")).toBe(false);
  });

  it("prefers the control whose type version matches the href path", () => {
    const control = findSrCtrlControl([
      {
        type: "urn:x-nmos:control:sr-ctrl/v1.0",
        href: "http://device/x-nmos/connection/v1.0/",
      },
      {
        type: "urn:x-nmos:control:sr-ctrl/v1.1",
        href: "http://device/x-nmos/connection/v1.1/",
      },
    ]);
    expect(control?.type).toBe("urn:x-nmos:control:sr-ctrl/v1.1");
  });
});

describe("isRtpTransport", () => {
  it("matches rtp transport URNs", () => {
    expect(isRtpTransport("urn:x-nmos:transport:rtp")).toBe(true);
    expect(isRtpTransport("urn:x-nmos:transport:rtp.mcast")).toBe(true);
    expect(isRtpTransport("urn:x-nmos:transport:websocket")).toBe(false);
  });
});

describe("discoverConnectionEndpoint", () => {
  it("finds versioned sr-ctrl controls", () => {
    const device = {
      id: "d1",
      version: "1:0",
      label: "D",
      description: "",
      type: "urn:x-nmos:device:generic",
      node_id: "n1",
      controls: [
        {
          type: "urn:x-nmos:control:sr-ctrl/v1.1",
          href: "http://192.168.10.3/x-nmos/connection/v1.1",
        },
      ],
    } satisfies NmosDevice;

    expect(discoverConnectionEndpoint(device)).toEqual({
      availability: "available",
      href: "http://192.168.10.3/x-nmos/connection/v1.1/",
      controlType: "urn:x-nmos:control:sr-ctrl/v1.1",
      ambiguous: false,
    });
  });

  it("marks devices without sr-ctrl as unavailable", () => {
    expect(
      discoverConnectionEndpoint({
        id: "d1",
        version: "1:0",
        label: "D",
        description: "",
        type: "urn:x-nmos:device:generic",
        node_id: "n1",
        controls: [
          { type: "urn:x-nmos:control:ncp/v1.0", href: "ws://x" },
        ],
      }),
    ).toEqual({ availability: "unavailable" });
  });

  it("rejects non-http hrefs", () => {
    expect(
      discoverConnectionEndpoint({
        id: "d1",
        version: "1:0",
        label: "D",
        description: "",
        type: "urn:x-nmos:device:generic",
        node_id: "n1",
        controls: [
          {
            type: "urn:x-nmos:control:sr-ctrl/v1.1",
            href: "ws://not-http",
          },
        ],
      }),
    ).toMatchObject({ availability: "unavailable", href: "ws://not-http" });
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
        {
          type: "urn:x-nmos:control:sr-ctrl/v1.1",
          href: "http://a/x-nmos/connection/v1.1/",
        },
      ],
    };
    const b = {
      ...a,
      controls: [
        {
          type: "urn:x-nmos:control:sr-ctrl/v1.1",
          href: "http://b/x-nmos/connection/v1.1/",
        },
      ],
    };
    expect(connectionApiHrefChanged(a, b)).toBe(true);
    expect(connectionApiHrefChanged(a, a)).toBe(false);
  });
});
