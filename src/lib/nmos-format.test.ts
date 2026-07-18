import { describe, expect, it } from "vitest";

import { classifyNmosFormat, nmosFormatLabel } from "@/lib/nmos-format";

describe("classifyNmosFormat", () => {
  it("maps register URNs", () => {
    expect(classifyNmosFormat("urn:x-nmos:format:video")).toBe("video");
    expect(classifyNmosFormat("urn:x-nmos:format:audio")).toBe("audio");
    expect(classifyNmosFormat("urn:x-nmos:format:data")).toBe("data");
    expect(classifyNmosFormat("urn:x-nmos:format:data.event")).toBe(
      "data.event",
    );
    expect(classifyNmosFormat("urn:x-nmos:format:mux")).toBe("mux");
  });

  it("handles missing and unknown formats", () => {
    expect(classifyNmosFormat(undefined)).toBe("unknown");
    expect(classifyNmosFormat("")).toBe("unknown");
    expect(classifyNmosFormat("urn:x-nmos:format:future")).toBe("unknown");
    expect(nmosFormatLabel("video")).toBe("Video");
    expect(nmosFormatLabel("data.event")).toBe("Event data");
  });

  it("accepts prefix-extended register URNs", () => {
    expect(classifyNmosFormat("urn:x-nmos:format:video.hdr")).toBe("video");
    expect(classifyNmosFormat("urn:x-nmos:format:audio.immersive")).toBe(
      "audio",
    );
    expect(classifyNmosFormat("urn:x-nmos:format:data.event.v2")).toBe(
      "data.event",
    );
    expect(classifyNmosFormat("urn:x-nmos:format:mux.st2110")).toBe("mux");
  });
});
