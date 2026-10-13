import { useMemo } from "react";
import {
  currentRoutePath,
  navigateToRoutePath,
  useCurrentRoutePath,
} from "../platform/navigation";
import {
  safeSessionStorageGet,
  safeSessionStorageRemove,
  safeSessionStorageSet,
} from "../utils/storage";
import {
  parseRoutePath,
  routePathFor,
  type NavigationAction,
  type Route,
} from "../types/route";

// Holds a route path; values stored before route paths start with `#`.
const BANK_PAYMENT_OFFER_RETURN_HASH_KEY =
  "linky.bank_payment_offer_return_hash.v1";

const rememberBankPaymentOfferReturnPath = (): void => {
  const currentPath = currentRoutePath();
  const currentRoute = parseRoutePath(currentPath);
  if (
    currentRoute.kind !== "chat" &&
    currentRoute.kind !== "contacts" &&
    currentRoute.kind !== "wallet"
  ) {
    return;
  }

  const returnPath =
    currentRoute.kind === "chat" ? currentPath : currentRoute.kind;
  safeSessionStorageSet(BANK_PAYMENT_OFFER_RETURN_HASH_KEY, returnPath);
};

export const returnFromBankPaymentOffer = (fallbackChatId: string): void => {
  const stored = safeSessionStorageGet(BANK_PAYMENT_OFFER_RETURN_HASH_KEY);
  safeSessionStorageRemove(BANK_PAYMENT_OFFER_RETURN_HASH_KEY);

  const returnPath = (stored ?? "").trim().replace(/^#/, "");
  if (
    returnPath === "contacts" ||
    returnPath === "wallet" ||
    (returnPath.startsWith("chat/") &&
      !returnPath.includes("/bank-payment-offer/"))
  ) {
    navigateToRoutePath(returnPath);
    return;
  }

  navigateTo({ route: "chat", id: fallbackChatId });
};

// The native back press is handled by `useNativeBackHandler`, which walks the
// route hierarchy instead of the browser history. See its doc comment for why
// `history.back()` is not usable here.
export const useRouting = (): Route => {
  const path = useCurrentRoutePath();
  return useMemo(() => parseRoutePath(path), [path]);
};

export const navigateTo = (action: NavigationAction): void => {
  if (action.route === "bankPaymentOffer") rememberBankPaymentOfferReturnPath();
  navigateToRoutePath(routePathFor(action));
};
