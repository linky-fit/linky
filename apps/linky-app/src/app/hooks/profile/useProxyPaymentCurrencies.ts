import { advertisedProxyPaymentCurrencies } from "@linky-fit/proxy-payment";
import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { ProfileStatusCurrency } from "../../../nostrStatus";
import { myProfileAtom } from "../../state/contacts/profiles";
import { useSetting } from "../useLinksync";

/** The own proxy payment currencies: the synced setting, else the own status's until the setting is carried over from it. */
export const ownProxyPaymentCurrencies = (
  setting: ReadonlyArray<string> | null,
  status: string | null,
): ProfileStatusCurrency[] =>
  advertisedProxyPaymentCurrencies(
    setting === null ? null : { proxyPaymentCurrencies: setting },
    status,
  );

/** The currencies the user pays bank transfers in for their contacts. */
export const useOwnProxyPaymentCurrencies = (): ProfileStatusCurrency[] => {
  const setting = useSetting("proxyPaymentCurrencies");
  const status = useAtomValue(myProfileAtom, (my) => my.status);
  return React.useMemo(
    () => ownProxyPaymentCurrencies(setting, status),
    [setting, status],
  );
};
