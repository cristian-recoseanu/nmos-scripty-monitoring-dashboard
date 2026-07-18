import type { ReactNode } from "react";
import styles from "./FieldList.module.css";

export type Field = {
  label: string;
  value: ReactNode;
};

export function FieldList({ fields }: { fields: Field[] }) {
  return (
    <dl className={styles.list}>
      {fields.map((field) => (
        <div key={field.label} className={styles.row}>
          <dt className={styles.label}>{field.label}</dt>
          <dd className={styles.value}>{field.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
