import React from "react";

import { useInspectorLogsEnabled } from "./inspectorEnabled";

export const usePersistentInspectorLogStartup = (): void => {
  const enabled = useInspectorLogsEnabled();

  React.useEffect(() => {
    if (!enabled) return;
    void import("./persistentInspectorLogSink")
      .then(({ initializePersistentInspectorLogs }) =>
        initializePersistentInspectorLogs(),
      )
      .catch(() => undefined);
  }, [enabled]);
};
