import { useAppLanguage } from "../app/hooks/useAppLanguage";

/** Full-screen wait while the one-time lane-to-shard migration copies local data. */
export const MigratingDataScreen = () => {
  const { t } = useAppLanguage();
  return (
    <div
      className="page migrating-data-screen"
      role="status"
      aria-live="polite"
    >
      <span className="btn-spinner migrating-data-spinner" aria-hidden="true" />
      <h1 className="migrating-data-title">{t("migratingDataTitle")}</h1>
      <p className="migrating-data-body">{t("migratingDataBody")}</p>
    </div>
  );
};
