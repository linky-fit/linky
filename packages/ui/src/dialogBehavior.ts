import { useEffect } from "react";
import { BackHandler } from "react-native";
import type { GetProps, Dialog } from "tamagui";

export type DialogBehaviorHook = (
  open: boolean,
  onOpenChange: (open: boolean) => void,
) => Pick<GetProps<typeof Dialog.Content>, "onCloseAutoFocus">;

export const useDialogBehavior: DialogBehaviorHook = (open, onOpenChange) => {
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
