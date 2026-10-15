import React from "react";
import {
  receivedSatByRequestId,
  type ReceivedSatByRequestId,
} from "../../lib/paymentRequestStatus";
import { useTransactionRecords } from "../useLinksync";

/** What the synced payment history received per request id, on every device of the account. */
export const useReceivedSatByRequestId = (): ReceivedSatByRequestId => {
  const records = useTransactionRecords();
  return React.useMemo(() => receivedSatByRequestId(records), [records]);
};
