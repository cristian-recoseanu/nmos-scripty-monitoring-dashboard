"use client";

import type { ReactNode } from "react";

import styles from "./DismissibleNotice.module.css";

export function DismissibleNotice({
  children,
  tone = "info",
  role = "status",
  variant = "banner",
  onDismiss,
}: {
  children: ReactNode;
  tone?: "info" | "ok" | "error";
  role?: "status" | "alert";
  variant?: "banner" | "inline";
  onDismiss: () => void;
}) {
  return (
    <div
      className={`${styles.notice} ${variant === "inline" ? styles.inline : styles.banner}`}
      data-tone={tone}
      role={role}
    >
      <div className={styles.body}>{children}</div>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
