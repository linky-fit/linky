import type { Translate } from "../i18n";

export const formatEvoluRowCount = (t: Translate, rows: number | null) =>
  rows === null
    ? t("unknown")
    : t("evoluRowCount").replace("{count}", String(rows));
