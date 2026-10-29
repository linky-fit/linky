import { PaymentBanner } from "@linky-fit/ui";
import { shortNpub } from "../format";
import { usePayerProfile } from "../services/react";
import {
  dismissPaidBanner,
  usePaidBanner,
  type PaidBanner,
} from "./paidBanner";

/** The payment that just arrived, over whatever the merchant is doing; closes on tap or by itself. */
export function PaidBannerHost() {
  const banner = usePaidBanner();
  return banner === null ? null : <Banner banner={banner} />;
}

function Banner({ banner }: { readonly banner: PaidBanner }) {
  const payer = usePayerProfile(banner.payerPubkey);
  return (
    <PaymentBanner
      title={banner.title}
      amount={banner.amount}
      unit={banner.unit}
      direction="in"
      avatar={
        banner.payerPubkey === null
          ? undefined
          : {
              // The banner prints the name under the title and takes its initials from it.
              name: payer?.name ?? shortNpub(banner.payerPubkey),
              uri: payer?.picture ?? undefined,
            }
      }
      onDismiss={dismissPaidBanner}
    />
  );
}
