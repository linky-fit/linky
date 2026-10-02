import React from "react";
import type { ContactId } from "../../../evolu";
import type { Route } from "../../../types/route";

interface UseRouteAmountResetEffectsParams {
  contactPayBackToChatRef: React.MutableRefObject<ContactId | null>;
  routeKind: Route["kind"];
  setContactPaymentIntent: React.Dispatch<
    React.SetStateAction<"pay" | "request">
  >;
  setLnAddressPayAmount: React.Dispatch<React.SetStateAction<string>>;
  setLnAddressPayNote: React.Dispatch<React.SetStateAction<string>>;
  setLnAddressPayContactId: React.Dispatch<
    React.SetStateAction<ContactId | null>
  >;
  setPayAmount: React.Dispatch<React.SetStateAction<string>>;
}

export const useRouteAmountResetEffects = ({
  contactPayBackToChatRef,
  routeKind,
  setContactPaymentIntent,
  setLnAddressPayAmount,
  setLnAddressPayNote,
  setLnAddressPayContactId,
  setPayAmount,
}: UseRouteAmountResetEffectsParams): void => {
  React.useEffect(() => {
    // Reset pay amount when leaving the pay page.
    if (routeKind !== "contactPay") {
      contactPayBackToChatRef.current = null;
      setContactPaymentIntent("pay");
      setPayAmount("");
    }
  }, [
    contactPayBackToChatRef,
    routeKind,
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
