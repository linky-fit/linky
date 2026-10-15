import { DataTable, DataValue } from "@linky-fit/ui";
import type { JsonValue } from "../types/json";
import { formatEvoluDebugValue } from "../utils/evoluDebugValue";

type EvoluCurrentRow = Record<string, JsonValue>;

interface EvoluCurrentTableProps {
  tableName: string;
  rows: readonly EvoluCurrentRow[];
}

const visibleColumns = (row: EvoluCurrentRow) =>
  Object.entries(row).filter(([key]) => key !== "createdAt");

export function EvoluCurrentTable({ tableName, rows }: EvoluCurrentTableProps) {
  return (
    <DataTable
      accessibilityLabel={tableName}
      columns={visibleColumns(rows[0] ?? {}).map(([key]) => ({
        key,
        label: key,
      }))}
      rows={rows.map((row, index) => ({
        key: String(index),
        cells: visibleColumns(row).map(([key, value]) => (
          <DataValue
            key={key}
            value={formatEvoluDebugValue(tableName, key, value)}
          />
        )),
      }))}
    />
  );
}
