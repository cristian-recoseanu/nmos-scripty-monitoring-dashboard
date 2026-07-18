import type { HealthContributor } from "@/server/domain";
import { HealthBadge } from "./HealthBadge";
import type { Selection } from "./useDashboardState";
import styles from "./ContributorsList.module.css";

export function ContributorsList({
  title,
  contributors,
  onSelect,
}: {
  title: string;
  contributors: HealthContributor[];
  onSelect?: (selection: Selection) => void;
}) {
  if (contributors.length === 0) {
    return (
      <section className={styles.section}>
        <h3 className={styles.heading}>{title}</h3>
        <p className={styles.empty}>No contributors.</p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{title}</h3>
      <ul className={styles.list}>
        {contributors.map((contributor) => (
          <li key={`${contributor.kind}:${contributor.id}`}>
            {onSelect ? (
              <button
                type="button"
                className={styles.rowButton}
                onClick={() =>
                  onSelect({ kind: contributor.kind, id: contributor.id })
                }
              >
                <ContributorRow contributor={contributor} />
              </button>
            ) : (
              <div className={styles.row}>
                <ContributorRow contributor={contributor} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContributorRow({ contributor }: { contributor: HealthContributor }) {
  return (
    <>
      <span className={styles.kind}>{contributor.kind}</span>
      <span className={styles.label}>{contributor.label}</span>
      <HealthBadge health={contributor.health} size="sm" />
      {contributor.message ? (
        <span className={styles.message}>{contributor.message}</span>
      ) : null}
    </>
  );
}
