import { Dialog, Stack } from "@linky-fit/ui";
import React from "react";

import { clientInspectorStore } from "../devtools/inspector/clientInspectorStore";
import { useInspectorEnabled } from "../devtools/inspector/inspectorEnabled";
import { InspectorApp } from "../devtools/inspectorPage/InspectorApp";
import { createInMemoryInspectorDataSource } from "../devtools/inspectorPage/inspectorDataSource";

export default function InspectorPage(): React.ReactElement {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const isCollecting = useInspectorEnabled();
  const dataSource = React.useMemo(
    () => createInMemoryInspectorDataSource(clientInspectorStore),
    [],
  );
  const inspector = (
    <InspectorApp
      dataSource={dataSource}
      isCollecting={isCollecting}
      isFullscreen={isFullscreen}
      onToggleFullscreen={() => setIsFullscreen((current) => !current)}
    />
  );

  return isFullscreen ? (
    <Dialog
      open
      onOpenChange={setIsFullscreen}
      title="Linky Inspector"
      hideTitle
      fullScreen
    >
      {inspector}
    </Dialog>
  ) : (
    <Stack
      width="100%"
      minHeight={0}
      height="100%"
      borderRadius="$control"
      overflow="hidden"
    >
      {inspector}
    </Stack>
  );
}
