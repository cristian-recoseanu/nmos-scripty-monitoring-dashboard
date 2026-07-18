import type { NmosFormatKind } from "@/lib/nmos-format";
import { nmosFormatLabel } from "@/lib/nmos-format";
import styles from "./FormatIcon.module.css";

export function FormatIcon({ format }: { format: NmosFormatKind }) {
  if (format === "unknown") {
    return null;
  }

  const label = nmosFormatLabel(format);

  return (
    <span
      className={styles.icon}
      data-format={format}
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {format === "video" ? (
          // Video camera (body + lens wedge)
          <path
            fill="currentColor"
            d="M1.75 4.5A1.5 1.5 0 0 1 3.25 3h6A1.5 1.5 0 0 1 10.75 4.5v7A1.5 1.5 0 0 1 9.25 13h-6A1.5 1.5 0 0 1 1.75 11.5v-7Zm10.1 1.05 2.55-1.45a.7.7 0 0 1 1.05.6v6.6a.7.7 0 0 1-1.05.6l-2.55-1.45V5.55Z"
          />
        ) : null}
        {format === "audio" ? (
          // Speaker with sound waves
          <path
            fill="currentColor"
            d="M7.9 2.35v11.3L4.2 10.7H2.2A1.05 1.05 0 0 1 1.15 9.65V6.35A1.05 1.05 0 0 1 2.2 5.3h2L7.9 2.35Zm2.55 2.55a2.9 2.9 0 0 1 0 6.2l-.85-1.15a1.65 1.65 0 0 0 0-3.9l.85-1.15Zm2.05-1.85a5 5 0 0 1 0 9.9l-.9-1.2a3.65 3.65 0 0 0 0-7.5l.9-1.2Z"
          />
        ) : null}
        {format === "data" ? (
          // Braces / data
          <path
            fill="currentColor"
            d="M5.1 2.75c-.9 0-1.6.7-1.6 1.55v2.1c0 .55-.2 1.05-.6 1.4.4.35.6.85.6 1.4v2.1c0 .85.7 1.55 1.6 1.55h.65v-1.35H5.2c-.15 0-.25-.1-.25-.25V9.2c0-.7-.3-1.35-.8-1.8.5-.45.8-1.1.8-1.8V4.55c0-.15.1-.25.25-.25h.55V2.75H5.1Zm5.8 0h-.65v1.35h.55c.15 0 .25.1.25.25V5.6c0 .7.3 1.35.8 1.8-.5.45-.8 1.1-.8 1.8v2.05c0 .15-.1.25-.25.25h-.55v1.35h.65c.9 0 1.6-.7 1.6-1.55v-2.1c0-.55.2-1.05.6-1.4-.4-.35-.6-.85-.6-1.4v-2.1c0-.85-.7-1.55-1.6-1.55Z"
          />
        ) : null}
        {format === "data.event" ? (
          // Lightning / event
          <path
            fill="currentColor"
            d="M9.1 1.75 4.4 9.1h3.05l-.85 5.15 5.35-8.1H8.85L9.1 1.75Z"
          />
        ) : null}
        {format === "mux" ? (
          // Layers / mux
          <path
            fill="currentColor"
            d="M8 1.6 13.5 4.5 8 7.4 2.5 4.5 8 1.6Zm0 7.05 5.5 2.9L8 14.45 2.5 11.55 8 8.65Zm0-1.85L3.7 4.5 8 2.75l4.3 1.75L8 6.8Z"
          />
        ) : null}
      </svg>
    </span>
  );
}
