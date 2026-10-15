import { DataTable, DataValue } from "@linky-fit/ui";
import type { EvoluHistoryRow } from "../evolu";
import { formatEvoluDebugValue } from "../utils/evoluDebugValue";
import type { Translate } from "../i18n";

interface EvoluHistoryTableProps {
  rows: readonly EvoluHistoryRow[];
  t: Translate;
}

export function EvoluHistoryTable({ rows, t }: EvoluHistoryTableProps) {
  return (
    <DataTable
      accessibilityLabel={t("evoluHistory")}
      columns={[
        { key: "table", label: t("evoluTable") },
        { key: "column", label: t("evoluColumn") },
        { key: "id", label: t("evoluId") },
        { key: "value", label: t("evoluValue"), span: 2 },
        { key: "timestamp", label: t("evoluTimestamp") },
      ]}
      rows={rows.map((row, index) => ({
        key: String(index),
        cells: [
          row.table,
          row.column,
          <DataValue key="id" value={row.id} previewLength={row.id.length} />,
          <DataValue
            key="value"
            value={formatEvoluDebugValue(row.table, row.column, row.value)}
          />,
          row.timestamp,
        ],
      }))}
    />
  );
}
