import { useEffect, useRef } from "react";
import type { DialogBehaviorHook } from "./dialogBehavior";

export const useDialogBehavior: DialogBehaviorHook = (open) => {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const rememberFocus = () => {
      const element = document.activeElement;
      if (
        element instanceof HTMLElement &&
        element !== document.body &&
        !element.closest("dialog, [role=dialog]")
      ) {
        opener.current = element;
      }
    };
    // The portal takes focus before Dialog.Content's autofocus callback runs.
    rememberFocus();
    document.addEventListener("focusin", rememberFocus);
    return () => document.removeEventListener("focusin", rememberFocus);
  }, [open]);
  return {
    onCloseAutoFocus: (event) => {
      event.preventDefault();
      opener.current?.focus();
    },
  };
};
