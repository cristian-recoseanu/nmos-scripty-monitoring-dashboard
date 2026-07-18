import styles from "./TransitionCount.module.css";

export function TransitionCount({
  count,
  label = "Total transitions",
}: {
  count: number;
  /** Accessible / tooltip label; the pill itself always shows Σ + value. */
  label?: string;
}) {
  const value = Number.isFinite(count) ? count : 0;
  return (
    <span
      className={styles.count}
      data-nonzero={value > 0 ? "true" : "false"}
      title={`${label}: ${value}`}
      aria-label={`${label}: ${value}`}
    >
      Σ {value}
    </span>
  );
}
