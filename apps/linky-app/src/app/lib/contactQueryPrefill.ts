import { isLightningAddress } from "../../lnurlPay";
import { stripLightningPrefix } from "../../utils/url";

interface ContactQueryPrefill {
  lnAddress: string;
  name: string;
}

export const getContactQueryPrefill = (query: string): ContactQueryPrefill => {
  const normalized = query.trim();
  if (!isLightningAddress(normalized)) {
    return { lnAddress: "", name: normalized };
  }

  return {
    lnAddress: stripLightningPrefix(normalized),
    name: "",
  };
};
