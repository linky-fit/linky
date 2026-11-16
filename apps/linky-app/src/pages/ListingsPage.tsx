import type { Listing } from "@linky-fit/linkstr";
import type { ListingId } from "@linky-fit/linksync";
import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  Avatar,
  AvatarGroup,
  EmptyState,
  Icon,
  ListRow,
  Row,
  Stack,
  SwipeRow,
  Text,
  type IconName,
  type SwipeAction,
} from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  usePeerListings,
  type PeerListing,
} from "../app/hooks/useCollaboration";
import { useListingRecords } from "../app/hooks/useLinksync";
import {
  useSetListingHidden,
  useSetListingPaused,
  useSetListingPinned,
} from "../app/hooks/useListingMarks";
import { formatListingPrice, listingOfRecord } from "../app/lib/listings";
import {
  listingAudienceLabel,
  listingAudienceOfRecord,
} from "../app/lib/listingAudience";
import { contactGroupsAtom } from "../app/state/contacts/readModel";
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

/** Where a row is listed, which decides what swiping it does. */
type PeerListingPlace = "pinned" | "listed" | "hidden";

/** Swiping left hides a listing, swiping right pins it, unpins it or shows a hidden one again. */
function usePeerListingSwipes(
  { author, listing }: PeerListing,
  place: PeerListingPlace,
  t: Translate,
): { swipeLeft?: SwipeAction; swipeRight: SwipeAction } {
  const setHidden = useSetListingHidden();
  const setPinned = useSetListingPinned();
  const hide: SwipeAction = {
    icon: "EyeOff",
    label: t("listingSwipeHide"),
    tone: "neutral",
    onTrigger: () => void setHidden(author, listing.id, true),
  };
  switch (place) {
    case "pinned":
      return {
        swipeLeft: hide,
        swipeRight: {
          icon: "PinOff",
          label: t("listingSwipeUnpin"),
          tone: "accent",
          onTrigger: () => void setPinned(author, listing.id, false),
        },
      };
    case "listed":
      return {
        swipeLeft: hide,
        swipeRight: {
          icon: "Pin",
          label: t("listingSwipePin"),
          tone: "accent",
          onTrigger: () => void setPinned(author, listing.id, true),
        },
      };
    case "hidden":
      return {
        swipeRight: {
          icon: "Eye",
          label: t("listingSwipeShow"),
          tone: "accent",
          onTrigger: () => void setHidden(author, listing.id, false),
        },
      };
  }
}

function PeerListingRow({
  entry,
  place,
  display,
  t,
}: {
  entry: PeerListing;
  place: PeerListingPlace;
  display: DisplayAmountOptions;
  t: Translate;
}): React.ReactElement {
  const { author, listing, seller, via } = entry;
  const swipes = usePeerListingSwipes(entry, place, t);
  return (
    <SwipeRow {...swipes} testID={`peer-listing-swipe-${place}`}>
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
    </SwipeRow>
  );
}

/** One of the user's own listings: swiping left pauses it, swiping right resumes a paused one. */
function OwnListingRow({
  id,
  listing,
  description,
  paused,
  price,
  onPress,
  t,
}: {
  id: ListingId;
  listing: Listing;
  description: string;
  paused: boolean;
  price: string;
  onPress: () => void;
  t: Translate;
}): React.ReactElement {
  const setPaused = useSetListingPaused();
  const swipes: { swipeLeft?: SwipeAction; swipeRight?: SwipeAction } = paused
    ? {
        swipeRight: {
          icon: "Play",
          label: t("listingResume"),
          tone: "accent",
          onTrigger: () => void setPaused(id, false),
        },
      }
    : {
        swipeLeft: {
          icon: "Pause",
          label: t("listingPause"),
          tone: "neutral",
          onTrigger: () => void setPaused(id, true),
        },
      };
  return (
    <SwipeRow
      {...swipes}
      testID={`own-listing-swipe-${paused ? "paused" : "active"}`}
    >
      <ListRow
        leading={
          <ListingThumbnail
            source={listing.image ?? null}
            label={listing.title}
          />
        }
        title={listing.title}
        description={description}
        trailing={<Price>{price}</Price>}
        onPress={onPress}
        testID="own-listing"
      />
    </SwipeRow>
  );
}

function PeerSection({
  display,
  entries,
  place,
  t,
  titleKey,
}: {
  display: DisplayAmountOptions;
  entries: ReadonlyArray<PeerListing>;
  place: PeerListingPlace;
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
          place={place}
          display={display}
          t={t}
        />
      ))}
    </Stack>
  );
}

/** The listings the user hid, folded under one row until the user opens it. */
/** A section kept out of the way: a row with the count that unfolds the listings. */
function CollapsedSection({
  icon,
  title,
  count,
  testID,
  children,
}: {
  icon: IconName;
  title: string;
  count: number;
  testID: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  if (count === 0) return null;
  return (
    <Stack gap="$sm">
      <ListRow
        icon={icon}
        title={title}
        value={count}
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
        testID={testID}
      />
      {open ? children : null}
    </Stack>
  );
}

/** Others' listings, what the user shares, and the way to add more. */
export function ListingsPage(): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  const display: DisplayAmountOptions = { displayCurrency, fiatRates, lang };
  const { pinned, offered, wanted, hidden } = usePeerListings();
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

  const active = mine.filter(({ record }) => record.pausedAtSec === null);
  const paused = mine.filter(({ record }) => record.pausedAtSec !== null);

  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const { groupCounts } = useAtomValue(contactGroupsAtom);
  const ownRow = ({ record, listing, audience }: (typeof mine)[number]) => (
    <OwnListingRow
      key={record.id}
      id={record.id}
      listing={listing}
      description={`${t(listing.side === "offer" ? "listingSideOffer" : "listingSideWant")} · ${listingAudienceLabel(audience, t, groupCounts)}`}
      paused={record.pausedAtSec !== null}
      price={formatListingPrice(listing, display, t)}
      onPress={() =>
        navigateTo(
          ownPubkey
            ? { route: "listing", author: ownPubkey, listingId: record.id }
            : { route: "listingEdit", id: record.id },
        )
      }
      t={t}
    />
  );
  const addButton = (
    <FloatingActionButton
      icon="Plus"
      label={t("listingAddNew")}
      onPress={() => navigateTo({ route: "listingNew" })}
      guide="listing-add"
      pinned
    />
  );
  if (
    pinned.length === 0 &&
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
          entries={pinned}
          place="pinned"
          titleKey="listingsPinned"
          t={t}
        />
        <PeerSection
          display={display}
          entries={offered}
          place="listed"
          titleKey="listingsOffered"
          t={t}
        />
        <PeerSection
          display={display}
          entries={wanted}
          place="listed"
          titleKey="listingsWanted"
          t={t}
        />
        <CollapsedSection
          icon="EyeOff"
          title={t("listingsHidden")}
          count={hidden.length}
          testID="hidden-listings"
        >
          {hidden.map((entry) => (
            <PeerListingRow
              key={`${entry.author}:${entry.listing.id}`}
              entry={entry}
              place="hidden"
              display={display}
              t={t}
            />
          ))}
        </CollapsedSection>
        {active.length > 0 ? (
          <Stack gap="$sm">
            <Text variant="title" role="heading">
              {t("listingsMine")}
            </Text>
            {active.map(ownRow)}
          </Stack>
        ) : null}
        <CollapsedSection
          icon="Pause"
          title={t("listingsPaused")}
          count={paused.length}
          testID="paused-listings"
        >
          {paused.map(ownRow)}
        </CollapsedSection>
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          {t("listingsMutualOnly")}
        </Text>
      </Stack>
    </>
  );
}
