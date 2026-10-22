import "./platform/browserPolyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { appConfig } from "./config";
import { createBrowserDevice } from "./platform/browserDevice";
import { finishPendingWipe } from "./platform/deviceWipe";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  // A reset started by the previous page finishes before anything opens storage.
  void finishPendingWipe().then(() => {
    const device = createBrowserDevice(appConfig);
    createRoot(root).render(
      <StrictMode>
        <App device={device} />
      </StrictMode>,
    );
  });
}
