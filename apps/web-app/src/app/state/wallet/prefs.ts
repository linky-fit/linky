import {
  RECEIVE_METHOD_STORAGE_KEY,
  WALLET_WARNING_DISMISSED_STORAGE_KEY,
} from "../../../utils/constants";
import { getInitialReceiveMethod } from "../../../utils/storage";
import { kvSeededAtom } from "../platform";

/** How the topup QR asks to be paid. */
export const receiveMethodAtom = kvSeededAtom(
  getInitialReceiveMethod,
  (kv, method) => kv.setItem(RECEIVE_METHOD_STORAGE_KEY, method),
  { persistSeed: true },
);

/** The large-balance warning was dismissed on this device. */
export const walletWarningDismissedAtom = kvSeededAtom(
  (kv) => kv.getItem(WALLET_WARNING_DISMISSED_STORAGE_KEY) === "1",
  (kv, dismissed) =>
    kv.setItem(WALLET_WARNING_DISMISSED_STORAGE_KEY, dismissed ? "1" : "0"),
);
