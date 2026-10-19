"use client";

import { useState } from "react";

import styles from "./DetailPanel.module.css";

type ReinitialiseTarget = {
  kind: "device" | "node";
  id: string;
};

type NodeReinitialiseBody = {
  error?: string;
  reinitialised?: number;
  skipped?: number;
  failures?: unknown[];
};

export function ReinitialiseButton({ kind, id }: ReinitialiseTarget) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setBusy(true);
    setMessage(null);
    setError(null);
    const path =
      kind === "device"
        ? `/api/devices/${encodeURIComponent(id)}/reinitialise`
        : `/api/nodes/${encodeURIComponent(id)}/reinitialise`;

    try {
      const response = await fetch(path, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as NodeReinitialiseBody;
      if (!response.ok) {
        throw new Error(body.error ?? `Reinitialise failed (${response.status})`);
      }

      if (kind === "device") {
        setMessage("NCP session restarted. Monitors are being re-acquired.");
        return;
      }

      const failures = body.failures?.length ?? 0;
      const skipped = body.skipped ?? 0;
      setMessage(
        `Restarted ${body.reinitialised ?? 0} device session(s)` +
          (skipped ? `, skipped ${skipped} without NCP` : "") +
          (failures ? `, ${failures} failed` : "") +
          ".",
      );
      if (failures > 0) {
        setError(`${failures} device reinitialise(s) failed`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reinitialise failed");
    } finally {
      setBusy(false);
    }
  }

  const title =
    kind === "device"
      ? "Close this device's NCP WebSocket, drop its sender and receiver monitors, then reconnect and re-acquire them"
      : "Reinitialise every child device: close each NCP WebSocket, drop its monitors, then reconnect and re-acquire them";

  return (
    <div className={styles.reinitialise}>
      <button
        type="button"
        className={styles.reinitialiseButton}
        disabled={busy}
        title={title}
        onClick={() => void onClick()}
      >
        {busy ? "Reinitialising…" : "Reinitialise"}
      </button>
      {message ? <p className={styles.reinitialiseMessage}>{message}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
