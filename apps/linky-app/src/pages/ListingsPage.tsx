import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  Avatar,
  AvatarGroup,
  EmptyState,
  Icon,
  ListRow,
  Row,
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
import {
  listingAudienceLabel,
  listingAudienceOfRecord,
} from "../app/lib/listingAudience";
import { currentPubkeyAtom } from "../app/state/session/session";
import type { DisplayAmountOptions } from "../utils/displayAmounts";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../components/FloatingActionButton";
import { ListingThumbnail } from "../components/ListingImage";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey, Translate } from "../i18n";

const Price = ({ children }: { children: string }) => (
  <Text variant="label" bold>
    {children}
  </Text>
);

/** The second line of a row: whose it is, or "via" and the contacts it came through, as avatars only, then the unit; names are on the detail. */
function ListingByline({
  prefix,
  people,
  unit,
  testID,
}: {
  prefix?: string | undefined;
  people: ReadonlyArray<{ name: string; uri: string | undefined }>;
  unit: string;
  testID: string;
}): React.ReactElement {
  return (
    <Row gap="$xs" alignItems="center" testID={testID}>
      {prefix ? (
        <Text variant="caption" color="$colorMuted" flexShrink={0}>
          {prefix}
        </Text>
      ) : null}
      {people.length === 1 && people[0] ? (
        <Avatar name={people[0].name} uri={people[0].uri} size="xs" />
      ) : (
        <AvatarGroup people={people} size="xs" max={4} />
      )}
      <Text variant="caption" color="$colorMuted" numberOfLines={1} flex={1}>
        {unit}
      </Text>
    </Row>
  );
}

function PeerListingRow({
  entry: { author, listing, seller, via },
  display,
  t,
}: {
  entry: PeerListing;
  display: DisplayAmountOptions;
  t: Translate;
}): React.ReactElement {
  return (
    <ListRow
      leading={
        <ListingThumbnail
          source={listing.image ?? null}
          label={listing.title}
        />
      }
      title={listing.title}
      description={
        seller ? (
          <ListingByline
            people={[
              { name: seller.name, uri: seller.pictureUrl ?? undefined },
            ]}
            unit={listing.unit}
            testID="listing-seller"
          />
        ) : (
          <ListingByline
            people={via.map(({ name, pictureUrl }) => ({
              name,
              uri: pictureUrl ?? undefined,
            }))}
            prefix={t("listingVia")}
            unit={listing.unit}
            testID="listing-via"
          />
        )
      }
      trailing={<Price>{formatListingPrice(listing, display, t)}</Price>}
      onPress={() =>
        navigateTo({
          route: "listing",
          author,
          listingId: listing.id,
        })
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
          key={`${entry.author}:${entry.listing.id}`}
          entry={entry}
          display={display}
          t={t}
        />
      ))}
    </Stack>
  );
}

/** The listings hidden on this device, folded under one row until the user opens it. */
function HiddenSection({
  display,
  entries,
  t,
}: {
  display: DisplayAmountOptions;
  entries: ReadonlyArray<PeerListing>;
  t: Translate;
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  if (entries.length === 0) return null;
  return (
    <Stack gap="$sm">
      <ListRow
        icon="EyeOff"
        title={t("listingsHidden")}
        value={entries.length}
        chevron={false}
        trailing={
          <Icon
            name={open ? "ChevronUp" : "ChevronDown"}
            size="sm"
            color="$colorMuted"
          />
        }
        expanded={open}
        onPress={() => setOpen((current) => !current)}
        testID="hidden-listings"
      />
      {open
        ? entries.map((entry) => (
            <PeerListingRow
              key={`${entry.author}:${entry.listing.id}`}
              entry={entry}
              display={display}
              t={t}
            />
          ))
        : null}
    </Stack>
  );
}

/** Others' listings, what the user shares, and the way to add more. */
export function ListingsPage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  const display: DisplayAmountOptions = { displayCurrency, fiatRates, lang };
  const { offered, wanted, hidden } = usePeerListings();
  const records = useListingRecords();
  const mine = React.useMemo(
    () =>
      [...records]
        .sort((left, right) => left.createdAtSec - right.createdAtSec)
        .flatMap((record) => {
          const listing = listingOfRecord(record);
          return listing === null
            ? []
            : [{ record, listing, audience: listingAudienceOfRecord(record) }];
        }),
    [records],
  );

  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const addButton = (
    <FloatingActionButton
      icon="Plus"
      label={t("listingAddNew")}
      onPress={() => navigateTo({ route: "listingNew" })}
      pinned
    />
  );
  if (
    offered.length === 0 &&
    wanted.length === 0 &&
    hidden.length === 0 &&
    mine.length === 0
  ) {
    return (
      <>
        <EmptyState
          icon="Package"
          title={t("listingsEmpty")}
          description={t("listingsMutualOnly")}
        />
        {addButton}
      </>
    );
  }

  return (
    <>
      {addButton}
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
            {mine.map(({ record, listing, audience }) => (
              <ListRow
                key={record.id}
                leading={
                  <ListingThumbnail
                    source={listing.image ?? null}
                    label={listing.title}
                  />
                }
                title={listing.title}
                description={`${t(listing.side === "offer" ? "listingSideOffer" : "listingSideWant")} · ${listingAudienceLabel(audience, t)}`}
                trailing={
                  <Price>{formatListingPrice(listing, display, t)}</Price>
                }
                onPress={() =>
                  navigateTo(
                    ownPubkey
                      ? {
                          route: "listing",
                          author: ownPubkey,
                          listingId: record.id,
                        }
                      : { route: "listingEdit", id: record.id },
                  )
                }
                testID="own-listing"
              />
            ))}
          </Stack>
        ) : null}
        <HiddenSection display={display} entries={hidden} t={t} />
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          {t("listingsMutualOnly")}
        </Text>
      </Stack>
    </>
  );
}
