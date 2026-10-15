import { getInspectorEmissionEnabled } from "./inspectorEnabled";
import type { InspectorRow } from "./inspectorRows";
import { reportInspectorRows } from "./reportInspectorRows";

type AppLogRow = Pick<InspectorRow, "payload" | "summary" | "tag"> & {
  links?: InspectorRow["links"];
};

export const reportAppLog = (row: AppLogRow): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "app.log",
      tag: row.tag,
      summary: row.summary,
      links: row.links ?? {},
      payload: row.payload,
    },
  ]);
};
