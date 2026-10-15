import {
  parseCollectedInspectorRow,
  type CollectedInspectorRow,
} from "../inspector/inspectorRows";
import { INSPECTOR_MAX_ROWS } from "../inspector/inspectorStore";

export interface InspectorImportResult {
  rows: CollectedInspectorRow[];
  skippedLineCount: number;
  truncatedRowCount: number;
}

const compareRows = (
  left: CollectedInspectorRow,
  right: CollectedInspectorRow,
): number => left.id - right.id || left.at - right.at;

export const parseInspectorNdjson = (
  text: string,
  maxRows: number = INSPECTOR_MAX_ROWS,
): InspectorImportResult => {
  const parsedRows: CollectedInspectorRow[] = [];
  const rowLimit = Math.max(0, Math.floor(maxRows));
  let skippedLineCount = 0;
  let validRowCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsedJson: unknown = JSON.parse(line);
      const row = parseCollectedInspectorRow(parsedJson);
      if (row) {
        validRowCount += 1;
        if (rowLimit > 0) {
          parsedRows.push(row);
          if (parsedRows.length > rowLimit * 2) {
            parsedRows.sort(compareRows);
            parsedRows.splice(0, parsedRows.length - rowLimit);
          }
        }
      } else {
        skippedLineCount += 1;
      }
    } catch {
      skippedLineCount += 1;
    }
  }

  parsedRows.sort(compareRows);
  const rows = parsedRows.slice(-rowLimit);
  return {
    rows,
    skippedLineCount,
    truncatedRowCount: validRowCount - rows.length,
  };
};
