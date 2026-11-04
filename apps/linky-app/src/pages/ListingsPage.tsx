import {
  Avatar,
  Button,
  EmptyState,
  ListRow,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  usePeerListings,
  type PeerListing,
} from "../app/hooks/useCollaboration";
import { useListingRecords } from "../app/hooks/useLinksync";
import { formatListingPrice, listingOfRecord } from "../app/lib/listings";
import type { DisplayAmountOptions } from "../utils/displayAmounts";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../components/FloatingActionButton";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey, Translate } from "../i18n";
import { firstName } from "../utils/formatting";

const Price = ({ children }: { children: string }) => (
  <Text variant="label" bold>
    {children}
  </Text>
);

function PeerListingRow({
  entry: { contact, listing },
  display,
}: {
  entry: PeerListing;
  display: DisplayAmountOptions;
}): React.ReactElement {
  const contactId = contact.contact.id;
  return (
    <ListRow
      leading={
        <Avatar
          name={contact.name}
          uri={contact.pictureUrl ?? undefined}
          size="md"
        />
      }
      title={listing.title}
      description={`${firstName(contact.name)} · ${listing.unit}`}
      trailing={
        <Price>
          {formatListingPrice(listing.amount, listing.currency, display)}
        </Price>
      }
      chevron={false}
      onPress={
        contactId
          ? () => navigateTo({ route: "chat", id: contactId })
          : undefined
      }
      testID="peer-listing"
    />
  );
}

function PeerSection({
  display,
  entries,
  t,
  titleKey,
}: {
  display: DisplayAmountOptions;
  entries: ReadonlyArray<PeerListing>;
  t: Translate;
  titleKey: I18nKey;
}): React.ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <Stack gap="$sm">
      <Text variant="title" role="heading">
        {t(titleKey)}
      </Text>
      {entries.map((entry) => (
        <PeerListingRow
          key={`${entry.contact.pubkey}:${entry.listing.id}`}
          entry={entry}
          display={display}
        />
      ))}
    </Stack>
  );
}

/** The contacts' listings, what the user shares, and the way to add more. */
export function ListingsPage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  const display: DisplayAmountOptions = { displayCurrency, fiatRates, lang };
  const { offered, wanted } = usePeerListings();
  const records = useListingRecords();
  const mine = React.useMemo(
    () =>
      [...records]
        .sort((left, right) => left.createdAtSec - right.createdAtSec)
        .flatMap((record) => {
          const listing = listingOfRecord(record);
          return listing === null ? [] : [{ record, listing }];
        }),
    [records],
  );

  const addListing = () => navigateTo({ route: "listingNew" });
  if (offered.length === 0 && wanted.length === 0 && mine.length === 0) {
    return (
      <EmptyState
        icon="Package"
        title={t("listingsEmpty")}
        description={t("listingsMutualOnly")}
        action={
          <Button icon="Plus" onPress={addListing}>
            {t("listingAddNew")}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <FloatingActionButton
        icon="Plus"
        label={t("listingAddNew")}
        onPress={addListing}
      />
      <Stack gap="$xxxl" paddingBottom={floatingActionButtonClearance}>
        <Text color="$colorMuted">{t("listingsLead")}</Text>
        <PeerSection
          display={display}
          entries={offered}
          titleKey="listingsOffered"
          t={t}
        />
        <PeerSection
          display={display}
          entries={wanted}
          titleKey="listingsWanted"
          t={t}
        />
        {mine.length > 0 ? (
          <Stack gap="$sm">
            <Text variant="title" role="heading">
              {t("listingsMine")}
            </Text>
            {mine.map(({ record, listing }) => (
              <ListRow
                key={record.id}
                title={listing.title}
                description={`${t(listing.side === "offer" ? "listingSideOffer" : "listingSideWant")} · ${listing.unit}`}
                trailing={
                  <Price>
                    {formatListingPrice(
                      listing.amount,
                      listing.currency,
                      display,
                    )}
                  </Price>
                }
                onPress={() =>
                  navigateTo({ route: "listingEdit", id: record.id })
                }
                testID="own-listing"
              />
            ))}
          </Stack>
        ) : null}
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          {t("listingsMutualOnly")}
        </Text>
      </Stack>
    </>
  );
}
