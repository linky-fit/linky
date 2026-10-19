import React from "react";
import { isAppVisible, onVisibilityChange } from "../platform/appEvents";

export const useDocumentVisible = (): boolean =>
  React.useSyncExternalStore(onVisibilityChange, isAppVisible, () => true);
