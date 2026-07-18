"use client";

import { useState } from "react";

import { formatNcStatus, mapOverallStatus } from "@/lib/health";
import type { MonitorDetailDto } from "@/server/domain/snapshot";
import { HealthBadge } from "./HealthBadge";
import { FieldList } from "./FieldList";
import { TransitionCount } from "./TransitionCount";
import styles from "./MonitorPanel.module.css";

type CounterType = "lost" | "late" | "transmission";

export function MonitorPanel({
  deviceId,
  monitor,
}: {
  deviceId: string;
  monitor: MonitorDetailDto;
}) {
  const [autoReset, setAutoReset] = useState(
    monitor.autoResetCountersAndMessages ?? true,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counters, setCounters] = useState<unknown>(null);

  async function runAction(
    label: string,
    action: () => Promise<Response>,
  ): Promise<void> {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const response = await action();
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        counters?: unknown;
        ok?: boolean;
        value?: boolean;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `${label} failed (${response.status})`);
      }
      if (body.counters !== undefined) {
        setCounters(body.counters);
        setMessage(`${label} retrieved`);
      } else if (typeof body.value === "boolean") {
        setAutoReset(body.value);
        setMessage(`autoReset set to ${body.value}`);
      } else {
        setMessage(`${label} succeeded`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  const base = `/api/monitors/${encodeURIComponent(deviceId)}/${monitor.oid}`;
  const overallHealth = mapOverallStatus(monitor.overallStatus);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Monitor</h3>
        <div className={styles.headerMeta}>
          <TransitionCount
            count={monitor.totalTransitions}
            label="Total transitions"
          />
          <HealthBadge health={monitor.health} />
        </div>
      </div>

      <FieldList
        fields={[
          { label: "OID", value: String(monitor.oid) },
          { label: "Role", value: monitor.role },
          {
            label: "Overall status",
            value: (
              <span className={styles.statusWithLight}>
                <HealthBadge health={overallHealth} size="sm" showLabel={false} />
                <span>{formatNcStatus(monitor.overallStatus)}</span>
              </span>
            ),
          },
          {
            label: "Overall message",
            value: monitor.overallStatusMessage ?? "—",
          },
          {
            label: "Total transitions",
            value: (
              <TransitionCount
                count={monitor.totalTransitions}
                label="Total transitions"
              />
            ),
          },
          {
            label: "Reporting delay (s)",
            value:
              monitor.statusReportingDelay !== undefined
                ? String(monitor.statusReportingDelay)
                : "—",
          },
          {
            label: "Sync source",
            value: monitor.synchronizationSourceId ?? "—",
          },
        ]}
      />

      <h4 className={styles.subheading}>Domain statuses</h4>
      <ul className={styles.domains}>
        {monitor.domains.map((domain) => {
          const domainHealth = mapOverallStatus(domain.status);
          return (
            <li key={domain.name} className={styles.domain}>
              <div className={styles.domainHeader}>
                <span className={styles.domainName}>{domain.name}</span>
                <HealthBadge health={domainHealth} size="sm" showLabel={false} />
                <span className={styles.domainStatus}>
                  {formatNcStatus(domain.status)}
                </span>
                {domain.transitionCounter !== undefined ? (
                  <TransitionCount
                    count={domain.transitionCounter}
                    label="transitions"
                  />
                ) : null}
              </div>
              {domain.message ? (
                <p className={styles.domainMessage}>{domain.message}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h4 className={styles.subheading}>Actions</h4>
      <div className={styles.actions}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={autoReset}
            disabled={busy !== null}
            onChange={(event) => {
              const value = event.target.checked;
              void runAction("Set autoReset", () =>
                fetch(`${base}/auto-reset`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ value }),
                }),
              );
            }}
          />
          Auto-reset counters & messages
        </label>

        <button
          type="button"
          className={styles.button}
          disabled={busy !== null}
          onClick={() =>
            void runAction("Reset", () =>
              fetch(`${base}/reset`, { method: "POST" }),
            )
          }
        >
          {busy === "Reset" ? "Resetting…" : "Reset counters & messages"}
        </button>

        {monitor.kind === "receiver" ? (
          <>
            <CounterButton
              label="Lost packets"
              busy={busy}
              onClick={() =>
                void runAction("Lost packets", () =>
                  fetchCounters(base, "lost"),
                )
              }
            />
            <CounterButton
              label="Late packets"
              busy={busy}
              onClick={() =>
                void runAction("Late packets", () =>
                  fetchCounters(base, "late"),
                )
              }
            />
          </>
        ) : (
          <CounterButton
            label="Transmission errors"
            busy={busy}
            onClick={() =>
              void runAction("Transmission errors", () =>
                fetchCounters(base, "transmission"),
              )
            }
          />
        )}
      </div>

      {message ? <p className={styles.message}>{message}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {counters !== null ? (
        <pre className={styles.counters}>{JSON.stringify(counters, null, 2)}</pre>
      ) : null}
    </section>
  );
}

function fetchCounters(base: string, type: CounterType): Promise<Response> {
  return fetch(`${base}/counters?type=${type}`);
}

function CounterButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.buttonSecondary}
      disabled={busy !== null}
      onClick={onClick}
    >
      {busy === label ? "Loading…" : label}
    </button>
  );
}
