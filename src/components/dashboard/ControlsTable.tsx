import type { NmosControl } from "@/server/is04/types";
import styles from "./ControlsTable.module.css";

export function ControlsTable({ controls }: { controls: NmosControl[] | undefined }) {
  if (!controls || controls.length === 0) {
    return <p className={styles.empty}>No controls advertised.</p>;
  }

  return (
    <div className={styles.wrap}>
      <h4 className={styles.heading}>Controls</h4>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Href</th>
          </tr>
        </thead>
        <tbody>
          {controls.map((control) => (
            <tr key={`${control.type}:${control.href}`}>
              <td className={styles.type}>{control.type}</td>
              <td className={styles.href}>
                <code>{control.href}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
