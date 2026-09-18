/* eslint-disable react-refresh/only-export-components */
import React from "react";
import type { RecurringPaymentsActions } from "../hooks/payments/useRecurringPaymentsActions";

const RecurringPaymentsContext =
  React.createContext<RecurringPaymentsActions | null>(null);

export const RecurringPaymentsProvider = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: RecurringPaymentsActions;
}): React.ReactElement => (
  <RecurringPaymentsContext.Provider value={value}>
    {children}
  </RecurringPaymentsContext.Provider>
);

export const useRecurringPaymentsContext = (): RecurringPaymentsActions => {
  const value = React.useContext(RecurringPaymentsContext);
  if (value === null) {
    throw new Error(
      "useRecurringPaymentsContext must be used within RecurringPaymentsProvider",
    );
  }
  return value;
};
