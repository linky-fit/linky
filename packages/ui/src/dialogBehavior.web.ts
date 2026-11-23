import { useState } from "react";
import type { DialogBehaviorHook } from "./dialogBehavior";

const focusOutsideDialogs = () => {
  const element = document.activeElement;
  return element instanceof HTMLElement &&
    element !== document.body &&
    !element.closest("dialog, [role=dialog]")
    ? element
    : null;
};

export const useDialogBehavior: DialogBehaviorHook = (open) => {
  const [opener, setOpener] = useState(() =>
    open ? focusOutsideDialogs() : null,
  );
  const [wasOpen, setWasOpen] = useState(open);
  // Read while rendering the opening, before the portal moves focus; also covers dialogs mounted open.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpener(focusOutsideDialogs());
  }
  return {
    tabIndex: -1,
    // Focus the dialog itself: a key released after opening must not press its first control.
    onOpenAutoFocus: (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.focus();
      }
    },
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      opener?.focus();
    },
  };
};
