import type { AtomRegistry } from "@linky-fit/linkstr-react";
import { StrictMode } from "react";
import App from "../App";
import { ErrorBoundary } from "../ErrorBoundary";
import { RegistryContext } from "../app/registry";
import { BootCommitSignal } from "../components/BootCommitSignal";
import { NavigationRoot } from "../platform/navigation";

interface AppRootProps {
  readonly registry: AtomRegistry.AtomRegistry;
  /** Runs once the app's first render commits. */
  readonly onCommit: () => void;
  /** Runs when a render error replaces the app with the crash screen. */
  readonly onError: () => void;
}

export const AppRoot = ({ registry, onCommit, onError }: AppRootProps) => (
  <StrictMode>
    <RegistryContext.Provider value={registry}>
      <ErrorBoundary onError={onError}>
        <NavigationRoot>
          <BootCommitSignal onCommit={onCommit} />
          <App />
        </NavigationRoot>
      </ErrorBoundary>
    </RegistryContext.Provider>
  </StrictMode>
);
