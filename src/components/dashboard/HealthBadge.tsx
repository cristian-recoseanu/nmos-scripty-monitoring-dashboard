import type { HealthSeverity } from "@/lib/health";
import styles from "./HealthBadge.module.css";

const LABELS: Record<HealthSeverity, string> = {
  unhealthy: "Unhealthy",
  degraded: "Degraded",
  unknown: "Unknown",
  healthy: "Healthy",
  inactive: "Inactive",
};

export function HealthBadge({
  health,
  size = "md",
  showLabel = true,
}: {
  health: HealthSeverity;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  return (
    <span
      className={`${styles.badge} ${styles[size]} ${showLabel ? "" : styles.lightOnly}`}
      data-health={health}
      title={LABELS[health]}
      aria-label={LABELS[health]}
    >
      <span className={styles.dot} aria-hidden="true" />
      {showLabel ? <span className={styles.label}>{LABELS[health]}</span> : null}
    </span>
  );
}
