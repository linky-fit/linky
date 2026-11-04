import { ListRow, Section, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useProxyPaymentPayerContacts } from "../app/hooks/contacts/useDisplayContacts";
import { useTranslation } from "../app/hooks/shell";
import {
  useCashContacts,
  usePeerListings,
} from "../app/hooks/useCollaboration";
import { navigateTo, useRouting } from "../hooks/useRouting";
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

  const route = useRouting();
  const destinations = [
    {
      key: "proxyPayments",
      icon: "QrCode",
      tone: "accent",
      label: t("collaborationProxy"),
      description:
        caption(payers.length, CONTACTS_PAY) ?? t("collaborationProxyHint"),
      active: route.kind === "proxyPayments",
      guide: "collaboration-proxy",
      testID: "open-proxy",
    },
    {
      key: "cash",
      icon: "Banknote",
      tone: "warning",
      label: t("cash"),
      description:
        caption(offering.length + wanting.length, CONTACTS_EXCHANGE) ??
        t("collaborationCashHint"),
      active: route.kind === "cash",
      guide: "collaboration-cash",
      testID: "open-cash",
    },
    {
      key: "listings",
      icon: "Package",
      tone: "info",
      label: t("listings"),
      description:
        caption(listings.offered.length + listings.wanted.length, LISTINGS) ??
        t("collaborationListingsHint"),
      active:
        route.kind === "listings" ||
        route.kind === "listingNew" ||
        route.kind === "listingEdit",
      guide: undefined,
      testID: "open-listings",
    },
  ] as const;

  return (
    <Stack gap="$xl">
      <Text color="$colorSubtle">{t("collaborationBody")}</Text>
      <Section grouped>
        {destinations.map((destination) => (
          <Stack key={destination.key} data-guide={destination.guide}>
            <ListRow
              icon={destination.icon}
              iconTone={destination.tone}
              title={destination.label}
              description={destination.description}
              active={destination.active}
              onPress={() => navigateTo({ route: destination.key })}
              testID={destination.testID}
            />
          </Stack>
        ))}
      </Section>
    </Stack>
  );
}
