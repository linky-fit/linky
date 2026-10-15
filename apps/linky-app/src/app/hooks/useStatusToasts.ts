import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { statusAtom } from "../state/shell/status";
import { toastCommandsAtom } from "../state/shell/toasts";

/** Shows each reported status as a toast, then clears it. */
export const useStatusToasts = (): void => {
  const [status, setStatus] = useAtom(statusAtom);
  const { pushToast } = useAtomValue(toastCommandsAtom);
  React.useEffect(() => {
    if (!status) return;
    pushToast(status);
    setStatus(null);
  }, [pushToast, setStatus, status]);
};
