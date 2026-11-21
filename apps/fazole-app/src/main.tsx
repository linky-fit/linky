import "./platform/browserPolyfills";
import { Button, Notice, Stack, UIProvider } from "@linky-fit/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { appConfig } from "./config";
import { copy } from "./copy";
import { createBrowserDevice } from "./platform/browserDevice";
import { finishPendingWipe, reloadApp } from "./platform/deviceWipe";
import { language } from "./platform/language";
import { registerPwa } from "./platform/pwa";
import { Page } from "./screens/Page";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  document.documentElement.lang = language;
  registerPwa();
  const reactRoot = createRoot(root);
  // A reset started by the previous page finishes before anything opens storage.
  void finishPendingWipe().then(
    () => {
      const device = createBrowserDevice(appConfig);
      reactRoot.render(
        <StrictMode>
          <App device={device} />
        </StrictMode>,
      );
    },
    (error: unknown) => {
      console.warn("[fazole] local database reset blocked", error);
      reactRoot.render(
        <StrictMode>
          <UIProvider mode="dark" brand="fazole">
            <Stack
              flex={1}
              gap="$none"
              backgroundColor="$background"
              data-safe-area="top"
            >
              <Page centered testID="wipe-failed-screen">
                <Notice
                  tone="warning"
                  title={copy.openFailed.otherTabTitle}
                  description={copy.openFailed.otherTabDescription}
                />
                <Button onPress={reloadApp}>{copy.openFailed.reload}</Button>
              </Page>
            </Stack>
          </UIProvider>
        </StrictMode>,
      );
    },
  );
}
