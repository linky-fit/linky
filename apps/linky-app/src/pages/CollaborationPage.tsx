import { ActionTile, Row, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useProxyPaymentPayerContacts } from "../app/hooks/contacts/useDisplayContacts";
import { useTranslation } from "../app/hooks/shell";
import {
  useCashContacts,
  usePeerListings,
} from "../app/hooks/useCollaboration";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey, Translate } from "../i18n";

type CountKeys = readonly [one: I18nKey, few: I18nKey, other: I18nKey];

/** Czech counts "1 kontakt", "2 kontakty", "5 kontaktů"; the other locales use `few` for everything above one. */
const countText = (count: number, keys: CountKeys, t: Translate): string =>
  t(
    count === 1 ? keys[0] : count >= 2 && count <= 4 ? keys[1] : keys[2],
  ).replace("{count}", String(count));

const CONTACTS_PAY: CountKeys = [
  "collaborationContactsPayOne",
  "collaborationContactsPayFew",
  "collaborationContactsPayOther",
];
const CONTACTS_EXCHANGE: CountKeys = [
  "collaborationContactsExchangeOne",
  "collaborationContactsExchangeFew",
  "collaborationContactsExchangeOther",
];
const LISTINGS: CountKeys = [
  "collaborationListingsOne",
  "collaborationListingsFew",
  "collaborationListingsOther",
];

export function CollaborationPage(): React.ReactElement {
  const { t } = useTranslation();
  const payers = useProxyPaymentPayerContacts();
  const { offering, wanting } = useCashContacts();
  const listings = usePeerListings();

  const caption = (count: number, keys: CountKeys): string | undefined =>
    count === 0 ? undefined : countText(count, keys, t);

  return (
    <Stack gap="$xxxl">
      <Text color="$colorMuted">{t("collaborationBody")}</Text>
      <Stack gap="$md">
        <Row gap="$md" alignItems="stretch">
          <ActionTile
            flex={1}
            icon="QrCode"
            label={t("collaborationProxy")}
            caption={caption(payers.length, CONTACTS_PAY)}
            onPress={() => navigateTo({ route: "proxyPayments" })}
            data-guide="collaboration-proxy"
            testID="open-proxy"
          />
          <ActionTile
            flex={1}
            icon="Banknote"
            label={t("cash")}
            caption={caption(
              offering.length + wanting.length,
              CONTACTS_EXCHANGE,
            )}
            onPress={() => navigateTo({ route: "cash" })}
            data-guide="collaboration-cash"
            testID="open-cash"
          />
        </Row>
        <ActionTile
          icon="Package"
          label={t("listings")}
          caption={caption(
            listings.offered.length + listings.wanted.length,
            LISTINGS,
          )}
          onPress={() => navigateTo({ route: "listings" })}
          testID="open-listings"
        />
      </Stack>
    </Stack>
  );
}
