/* eslint-disable react-refresh/only-export-components */
import type { ContactId } from "@linky-fit/linksync";
import React from "react";
import type { SendMintBalance } from "../lib/paymentMintSelection";

export interface SupporterContextValue {
  /** Visible per-mint balances, which the donate screen picks a mint from. */
  mintBalances: ReadonlyArray<SendMintBalance>;
  /** Opens the donate screen; null until Linky Bot is configured. */
  openDonate: (() => void) | null;
  /** One Cashu payment to the contact from `mint`, staying on the screen; whether it went out. */
  payContactFromMint: (payment: {
    amountSat: number;
    contactId: ContactId;
    mint: string;
  }) => Promise<boolean>;
}

const SupporterContext = React.createContext<SupporterContextValue | null>(
  null,
);

export const SupporterProvider = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: SupporterContextValue;
}): React.ReactElement => (
  <SupporterContext.Provider value={value}>
    {children}
  </SupporterContext.Provider>
);

export const useSupporterContext = (): SupporterContextValue => {
  const value = React.useContext(SupporterContext);
  if (value === null) {
    throw new Error(
      "useSupporterContext must be used within SupporterProvider",
    );
  }
  return value;
};
