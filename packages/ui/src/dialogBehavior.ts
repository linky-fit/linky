import { useEffect, useState } from "react";
import { BackHandler, TextInput } from "react-native";
import type { GetProps, Dialog } from "tamagui";

export type DialogBehaviorHook = (
  open: boolean,
  onOpenChange: (open: boolean) => void,
) => Partial<
  Pick<
    GetProps<typeof Dialog.Content>,
    "tabIndex" | "onOpenAutoFocus" | "onCloseAutoFocus"
  >
>;

const focusedInput = () => TextInput.State.currentlyFocusedInput();

export const useDialogBehavior: DialogBehaviorHook = (open, onOpenChange) => {
  const [opener, setOpener] = useState(() => (open ? focusedInput() : null));
  const [wasOpen, setWasOpen] = useState(open);
  // Read while rendering the opening, before an input inside the dialog takes focus.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpener(focusedInput());
  }
  useEffect(() => {
    if (open && opener && focusedInput() === opener) {
      TextInput.State.blurTextInput(opener);
    }
  }, [open, opener]);
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onOpenChange(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [open, onOpenChange]);
  return {};
};
