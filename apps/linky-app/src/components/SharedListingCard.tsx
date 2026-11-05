import type { SharedListing } from "@linky-fit/linkstr";
import { Pill, Pressable, Row, Stack, Text } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useListingPriceText } from "../app/hooks/useCollaboration";
import { ListingImage } from "./ListingImage";

interface SharedListingCardProps {
  /** "Your listing" or "Alice's listing". */
  authorLabel: string;
  onOpen: () => void;
  shared: SharedListing;
}

/** The listing a chat message carries: photo, side, title and price; a tap opens its detail. */
export function SharedListingCard({
  authorLabel,
  onOpen,
  shared: { listing },
}: SharedListingCardProps): React.ReactElement {
  const { t } = useTranslation();
  const priceText = useListingPriceText();
  return (
    <Pressable
      onPress={onOpen}
      alignItems="stretch"
      aria-label={`${listing.title}, ${priceText(listing)}`}
      testID="chat-shared-listing"
    >
      <Stack flex={1} gap="$sm" minWidth="$qr">
        {listing.image ? (
          <ListingImage source={listing.image} label={listing.title} t={t} />
        ) : null}
        <Row justifyContent="space-between" alignItems="center" gap="$sm">
          <Text eyebrow numberOfLines={1}>
            {authorLabel}
          </Text>
          <Pill
            size="sm"
            tone={listing.side === "offer" ? "accent" : "info"}
            label={t(
              listing.side === "offer" ? "listingSideOffer" : "listingSideWant",
            )}
          />
        </Row>
        <Text bold>{listing.title}</Text>
        <Text variant="caption" color="$colorSubtle">
          {priceText(listing)}
        </Text>
      </Stack>
    </Pressable>
  );
}
