import React from "react";
import type { Route } from "../../../types/route";

interface UseContactPayMethodParams {
  payWithCashuEnabled: boolean;
  routeKind: Route["kind"];
  selectedContactLnAddress: string;
  selectedContactNpub: string;
  setContactPayMethod: React.Dispatch<
    React.SetStateAction<null | "cashu" | "lightning">
  >;
}

export const useContactPayMethod = ({
  payWithCashuEnabled,
  routeKind,
  selectedContactLnAddress,
  selectedContactNpub,
  setContactPayMethod,
}: UseContactPayMethodParams): void => {
  React.useEffect(() => {
    if (routeKind !== "contactPay") {
      setContactPayMethod(null);
      return;
    }

    const npub = selectedContactNpub.trim();
    const ln = selectedContactLnAddress.trim();
    const canUseCashu = payWithCashuEnabled && Boolean(npub);
    const canUseLightning = Boolean(ln);

    // Default: prefer cashu when possible.
    if (canUseCashu) {
      setContactPayMethod("cashu");
      return;
    }

    if (canUseLightning) {
      setContactPayMethod("lightning");
      return;
    }

    // No usable method; keep a stable default for UI.
    setContactPayMethod("lightning");
  }, [
    payWithCashuEnabled,
    routeKind,
    selectedContactLnAddress,
    selectedContactNpub,
    setContactPayMethod,
  ]);
};
