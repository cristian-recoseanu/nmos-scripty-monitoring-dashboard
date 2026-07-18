/**
 * NMOS format URNs from the AMWA parameter register:
 * https://specs.amwa.tv/nmos-parameter-registers/branches/main/formats/
 */

export const NMOS_FORMATS = [
  "video",
  "audio",
  "data",
  "data.event",
  "mux",
  "unknown",
] as const;

export type NmosFormatKind = (typeof NMOS_FORMATS)[number];

const FORMAT_LABELS: Record<NmosFormatKind, string> = {
  video: "Video",
  audio: "Audio",
  data: "Data",
  "data.event": "Event data",
  mux: "Multiplexed",
  unknown: "Unknown format",
};

/**
 * Map a `format` URN (source/flow/receiver) onto a register kind.
 * Tolerates unknown / future URNs as `unknown`.
 */
export function classifyNmosFormat(
  format: string | null | undefined,
): NmosFormatKind {
  if (!format) {
    return "unknown";
  }

  // Prefer longest known suffix match (data.event before data).
  if (
    format === "urn:x-nmos:format:data.event" ||
    format.startsWith("urn:x-nmos:format:data.event")
  ) {
    return "data.event";
  }
  if (
    format === "urn:x-nmos:format:video" ||
    format.startsWith("urn:x-nmos:format:video")
  ) {
    return "video";
  }
  if (
    format === "urn:x-nmos:format:audio" ||
    format.startsWith("urn:x-nmos:format:audio")
  ) {
    return "audio";
  }
  if (
    format === "urn:x-nmos:format:mux" ||
    format.startsWith("urn:x-nmos:format:mux")
  ) {
    return "mux";
  }
  if (
    format === "urn:x-nmos:format:data" ||
    format.startsWith("urn:x-nmos:format:data")
  ) {
    return "data";
  }

  return "unknown";
}

export function nmosFormatLabel(kind: NmosFormatKind): string {
  return FORMAT_LABELS[kind];
}
