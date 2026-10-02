/* eslint-disable react-refresh/only-export-components */
import React from "react";
import type { RecurringPaymentsActions } from "../hooks/payments/useRecurringPaymentsActions";
import type { RecurringPaymentsScheduler } from "../hooks/payments/useRecurringPaymentsScheduler";

export type RecurringPaymentsContextValue = RecurringPaymentsActions &
  Pick<
    RecurringPaymentsScheduler,
    "cancelDue" | "confirmDueNow" | "dueConfirmation"
  > & {
    /** The mint a new payment is bound to. */
    defaultMintUrl: string;
    /** Available sats at one mint, which is all a payment can use. */
    mintBalanceSat: (mintUrl: string) => number;
  };

const RecurringPaymentsContext =
  React.createContext<RecurringPaymentsContextValue | null>(null);

export const RecurringPaymentsProvider = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: RecurringPaymentsContextValue;
}): React.ReactElement => (
  <RecurringPaymentsContext.Provider value={value}>
    {children}
  </RecurringPaymentsContext.Provider>
);

export const useRecurringPaymentsContext =
  (): RecurringPaymentsContextValue => {
    const value = React.useContext(RecurringPaymentsContext);
    if (value === null) {
      throw new Error(
        "useRecurringPaymentsContext must be used within RecurringPaymentsProvider",
      );
    }
    return value;
  };
