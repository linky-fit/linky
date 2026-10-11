import { useAtomSuspense } from "@linky-fit/linkstr-react";
import { ownerStorageAtom } from "../../state/wallet/ownerStorage";
import { paymentLogAtom } from "../../state/wallet/paymentLog";

/** The session owner's payment history and telemetry queue. */
export const usePaymentLog = () => useAtomSuspense(paymentLogAtom).value;

/** Device-local storage scoped to the session's app owner. */
export const useOwnerStorage = () => useAtomSuspense(ownerStorageAtom).value;
