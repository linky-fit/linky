import type { EvoluHistoryRow } from "../evolu";
import type { Translate } from "../i18n";

interface EvoluHistoryTableProps {
  rows: readonly EvoluHistoryRow[];
  t: Translate;
}

export function EvoluHistoryTable({ rows, t }: EvoluHistoryTableProps) {
  return (
    <table className="evolu-data-table">
      <thead>
        <tr className="evolu-data-header-row">
          <th className="evolu-data-bordered-heading">{t("evoluTable")}</th>
          <th className="evolu-data-bordered-heading">{t("evoluColumn")}</th>
          <th className="evolu-data-bordered-heading">{t("evoluId")}</th>
          <th className="evolu-data-bordered-heading">{t("evoluValue")}</th>
          <th className="evolu-data-bordered-heading">{t("evoluTimestamp")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx}>
            <td className="evolu-data-cell">{row.table}</td>
            <td className="evolu-data-cell">{row.column}</td>
            <td className="evolu-data-id-cell" title={row.id}>
              {row.id}
            </td>
            <td
              className="evolu-data-value-cell"
              title={String(row.value ?? "")}
            >
              {typeof row.value === "object" && row.value !== null
                ? JSON.stringify(row.value).slice(0, 40)
                : String(row.value ?? "").slice(0, 40)}
            </td>
            <td className="evolu-data-timestamp-cell">{row.timestamp}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
