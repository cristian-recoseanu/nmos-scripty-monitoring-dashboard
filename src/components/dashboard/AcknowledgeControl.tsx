"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { AckableKind } from "@/server/domain/acknowledgement-store";
import styles from "./AcknowledgeControl.module.css";

const OPTIONS = [
  { value: false, label: "Unacked" },
  { value: true, label: "Acked" },
] as const;

export function AcknowledgeControl({
  kind,
  id,
  acknowledged,
}: {
  kind: AckableKind;
  id: string;
  acknowledged: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function onChange(next: boolean): Promise<void> {
    setOpen(false);
    if (next === acknowledged) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, acknowledged: next }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Ack failed (${response.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ack failed");
    } finally {
      setBusy(false);
    }
  }

  const currentLabel = acknowledged ? "Acked" : "Unacked";

  return (
    <div className={styles.wrap} ref={rootRef}>
      <div className={styles.menuRoot}>
        <button
          type="button"
          className={styles.trigger}
          disabled={busy}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Acknowledge resource state"
          onClick={() => setOpen((value) => !value)}
        >
          <span>{currentLabel}</span>
          <span className={styles.chevron} aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <ul
            id={listId}
            className={styles.menu}
            role="listbox"
            aria-label="Acknowledge resource state"
          >
            {OPTIONS.map((option) => {
              const selected = option.value === acknowledged;
              return (
                <li key={option.label} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`${styles.option} ${selected ? styles.optionSelected : ""}`}
                    disabled={busy}
                    onClick={() => void onChange(option.value)}
                  >
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
