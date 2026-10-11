import { useAtomValue } from "@linky-fit/linkstr-react";
import { toastCommandsAtom, toastsAtom } from "../app/state/shell/toasts";

export type {
  PushToastOptions,
  Toast,
  ToastAction,
} from "../app/state/shell/toasts";

/** The toasts on screen and the commands that show and dismiss them. */
export const useToasts = () => {
  const { dismissToast, pushToast } = useAtomValue(toastCommandsAtom);
  const toasts = useAtomValue(toastsAtom);
  return { dismissToast, toasts, pushToast };
};
