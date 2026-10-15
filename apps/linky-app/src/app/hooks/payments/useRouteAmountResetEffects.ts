import React from "react";
import type { ContactId } from "../../../evolu";
import type { Route } from "../../../types/route";
import { useSetNavIntent } from "../shell/navIntents";

interface UseRouteAmountResetEffectsParams {
  routeKind: Route["kind"];
  setContactPaymentIntent: (intent: "pay" | "request") => void;
  setLnAddressPayAmount: (amount: string) => void;
  setLnAddressPayNote: (note: string) => void;
  setLnAddressPayContactId: (contactId: ContactId | null) => void;
  setPayAmount: (amount: string) => void;
}

export const useRouteAmountResetEffects = ({
  routeKind,
  setContactPaymentIntent,
  setLnAddressPayAmount,
  setLnAddressPayNote,
  setLnAddressPayContactId,
  setPayAmount,
}: UseRouteAmountResetEffectsParams): void => {
  const setContactPayBackToChat = useSetNavIntent("contactPayBackToChat");
  React.useEffect(() => {
    // Reset pay amount when leaving the pay page.
    if (routeKind !== "contactPay") {
      setContactPayBackToChat(null);
      setContactPaymentIntent("pay");
      setPayAmount("");
    }
  }, [
    routeKind,
    setContactPayBackToChat,
    setContactPaymentIntent,
    setPayAmount,
  ]);

  React.useEffect(() => {
    if (routeKind !== "lnAddressPay") {
      setLnAddressPayAmount("");
      setLnAddressPayNote("");
      setLnAddressPayContactId(null);
    }
  }, [
    routeKind,
    setLnAddressPayAmount,
    setLnAddressPayContactId,
    setLnAddressPayNote,
  ]);
};
