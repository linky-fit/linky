import { createRoot } from "react-dom/client";

import { InspectorApp } from "./InspectorApp";
import { createHttpInspectorDataSource } from "./inspectorDataSource";
import { UIProvider, Stack } from "@linky-fit/ui";
import "../../index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Inspector root element was not found");
}

createRoot(root).render(
  <UIProvider mode="dark">
    <Stack position="fixed" inset="$none">
      <InspectorApp
        dataSource={createHttpInspectorDataSource()}
        title="Linky Inspector"
      />
    </Stack>
  </UIProvider>,
);
