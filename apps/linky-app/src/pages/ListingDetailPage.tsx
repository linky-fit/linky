import {
  encodeNpub,
  SharedListing,
  type Listing,
  type Pubkey,
} from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  ContactId,
  hiddenListingKey,
  type MessageId,
} from "@linky-fit/linksync";
import {
  Avatar,
  Button,
  EmptyState,
  Icon,
  ListRow,
  Pill,
  Pressable,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import {
  useContacts,
  useNpubMessageContactInfo,
} from "../app/hooks/contacts/useDisplayContacts";
import { buildUnknownContactId } from "../app/hooks/messages/contactIdentity";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import {
  useHiddenListingKeys,
  useSetListingHidden,
} from "../app/hooks/useHiddenListings";
import { useListingRecords } from "../app/hooks/useLinksync";
import {
  useAttachListingToChat,
  useSharedListingOfMessage,
} from "../app/hooks/useSharedListing";
import { formatListingPrice, listingOfRecord } from "../app/lib/listings";
import {
  listingAudienceLabel,
  listingAudienceOfRecord,
  type ListingAudience,
} from "../app/lib/listingAudience";
import {
  useAllPeerListings,
  type PeerListing,
} from "../app/hooks/useCollaboration";
import { useStrangerProfile } from "../app/hooks/profile/useStrangerProfile";
import { blockListAtom } from "../app/state/contacts/blockList";
import { contactGroupsAtom } from "../app/state/contacts/readModel";
import { currentPubkeyAtom } from "../app/state/session/session";
import { ListingImage } from "../components/ListingImage";
import { navigateTo } from "../hooks/useRouting";
import { isDeletedContact } from "../utils/contactName";
import { firstName } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

interface ListingDetailPageProps {
  author: Pubkey;
  listingId: string;
  /** The message whose copy of the listing to show, instead of the live one. */
  messageId: MessageId | null;
}

const asContactId = (id: unknown): ContactId | null => {
  const result = ContactId.fromUnknown(id);
  return result.ok ? result.value : null;
};

/** The author's live listing: the own row with who sees it, or what reaches the user from the author or through contacts. */
const useLiveListing = (
  author: Pubkey,
  listingId: string,
  isOwn: boolean,
): {
  listing: Listing;
  audience: ListingAudience | null;
  via: PeerListing["via"];
} | null => {
  const records = useListingRecords();
  const entries = useAllPeerListings();
  return React.useMemo(() => {
    if (isOwn) {
      const record = records.find((candidate) => candidate.id === listingId);
      const listing = record ? listingOfRecord(record) : null;
      return record && listing
        ? { listing, audience: listingAudienceOfRecord(record), via: [] }
        : null;
    }
    const entry = entries.find(
      (candidate) =>
        candidate.author === author && candidate.listing.id === listingId,
    );
    return entry
      ? { listing: entry.listing, audience: null, via: entry.via }
      : null;
  }, [author, entries, isOwn, listingId, records]);
};

/** The author's avatar with their first name under it, beside the title; opens the contact when there is one. */
function ListingAuthor({
  label,
  name,
  onPress,
  pictureUrl,
}: {
  label: string;
  name: string;
  onPress: (() => void) | undefined;
  pictureUrl: string | null | undefined;
}): React.ReactElement {
  const content = (
    <>
      <Avatar name={name} uri={pictureUrl ?? undefined} size="md" />
      <Text
        variant="caption"
        color="$colorSubtle"
        numberOfLines={1}
        textAlign="center"
        alignSelf="stretch"
      >
        {label}
      </Text>
    </>
  );
  const frame = {
    flexDirection: "column",
    alignItems: "center",
    gap: "$xxs",
    width: "$row",
    flexShrink: 0,
    testID: "listing-author",
  } as const;
  return onPress ? (
    <Pressable onPress={onPress} aria-label={name} {...frame}>
      {content}
    </Pressable>
  ) : (
    <Stack {...frame}>{content}</Stack>
  );
}

/** One listing with its photo, price, description and author, and what the user can do with it. */
export function ListingDetailPage({
  author,
  listingId,
  messageId,
}: ListingDetailPageProps): React.ReactElement {
  const { lang, t } = useTranslation();
  const { displayCurrency, fiatRates } = useDisplayAmounts();
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const ownProfile = useEffectiveProfile();
  const isOwn = author === ownPubkey;
  const liveEntry = useLiveListing(author, listingId, isOwn);
  const live = liveEntry?.listing ?? null;
  const via = messageId ? [] : (liveEntry?.via ?? []);
  const snapshot = useSharedListingOfMessage(messageId);
  const snapshotMatchesRoute =
    snapshot?.author === author && snapshot.listing.id === listingId;
  const shared = messageId
    ? snapshotMatchesRoute
      ? snapshot
      : null
    : live && new SharedListing({ author, listing: live });
  const authorNpub = encodeNpub(author);
  const contacts = useContacts();
  const contactsByNpub = React.useMemo(() => {
    const byNpub = new Map<string, (typeof contacts)[number]>();
    for (const candidate of contacts) {
      const npub = normalizeNpubIdentifier(candidate.npub ?? "");
      if (npub && !isDeletedContact(candidate)) byNpub.set(npub, candidate);
    }
    return byNpub;
  }, [contacts]);
  const contact = contactsByNpub.get(authorNpub) ?? null;
  const contactId = asContactId(contact?.id);
  const authorInfo = useNpubMessageContactInfo()(authorNpub);
  // Writing to an author who is not a contact keeps them an unknown sender until the user adds them.
  const blocked = useAtomValue(blockListAtom).includes(author);
  const unknownChatId = blocked ? null : buildUnknownContactId(author);
  const attachListingToChat = useAttachListingToChat();
  const setListingHidden = useSetListingHidden();
  const hidden = useHiddenListingKeys().has(
    hiddenListingKey(author, listingId),
  );
  const stranger = useStrangerProfile(
    authorNpub,
    !isOwn && contactId === null && !blocked,
  );
  const { groupCounts } = useAtomValue(contactGroupsAtom);

  if (!shared) {
    return <EmptyState icon="Package" title={t("listingNotFound")} />;
  }

  const { listing } = shared;
  const authorName = isOwn
    ? (ownProfile.effectiveProfileName ?? "")
    : (stranger?.name ?? authorInfo?.displayName ?? "");
  const authorPicture = isOwn
    ? ownProfile.effectiveProfilePicture
    : (stranger?.pictureUrl ?? authorInfo?.pictureUrl);
  // The list shows only the contacts a stranger's listing came through; here the author shows too, and the user may ask those contacts.
  const askVia = !isOwn && contactId === null && via.length > 0;

  return (
    <Stack gap="$lg">
      {listing.image ? (
        <ListingImage source={listing.image} label={listing.title} t={t} />
      ) : null}
      <Stack gap="$sm" alignItems="flex-start">
        <Pill
          size="sm"
          tone={listing.side === "offer" ? "accent" : "info"}
          label={t(
            listing.side === "offer" ? "listingSideOffer" : "listingSideWant",
          )}
        />
        <Row gap="$md" alignItems="flex-start" alignSelf="stretch">
          <Text variant="heading" role="heading" flex={1}>
            {listing.title}
          </Text>
          <ListingAuthor
            name={authorName}
            pictureUrl={authorPicture}
            label={isOwn ? t("nearbyYou") : firstName(authorName)}
            onPress={
              contactId && !isOwn
                ? () => navigateTo({ route: "contact", id: contactId })
                : undefined
            }
          />
        </Row>
        <Row gap="$sm" alignItems="baseline" flexWrap="wrap">
          <Text variant="title" bold testID="listing-price">
            {formatListingPrice(
              listing,
              { displayCurrency, fiatRates, lang },
              t,
            )}
          </Text>
          <Text color="$colorMuted">{listing.unit}</Text>
        </Row>
        {isOwn && liveEntry ? (
          <Row gap="$xs" alignItems="center" testID="listing-audience">
            <Icon name="Eye" size="sm" color="$colorMuted" />
            <Text variant="caption" color="$colorMuted">
              {listingAudienceLabel(liveEntry.audience, t, groupCounts)}
            </Text>
          </Row>
        ) : null}
      </Stack>
      {listing.description ? (
        <Text
          whiteSpace="pre-wrap"
          wordWrap="break-word"
          testID="listing-description"
        >
          {listing.description}
        </Text>
      ) : null}
      <Stack gap="$sm">
        {isOwn ? (
          live ? (
            <Button
              icon="Pencil"
              onPress={() =>
                navigateTo({ route: "listingEdit", id: listingId })
              }
              testID="listing-edit"
            >
              {t("edit")}
            </Button>
          ) : null
        ) : (
          <>
            {contactId ? (
              <Button
                icon="Reply"
                onPress={() => attachListingToChat(contactId, shared)}
                testID="listing-reply"
              >
                {t("listingReply")}
              </Button>
            ) : unknownChatId ? (
              <Button
                icon="MessageCircle"
                onPress={() => attachListingToChat(unknownChatId, shared)}
                testID="listing-contact-author"
              >
                {t("listingContactAuthor")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              icon={hidden ? "Eye" : "EyeOff"}
              onPress={() => void setListingHidden(author, listingId, !hidden)}
              testID={hidden ? "listing-show" : "listing-hide"}
            >
              {t(hidden ? "listingShow" : "listingHide")}
            </Button>
            {askVia ? (
              <Stack gap="$xs" paddingTop="$sm" testID="listing-via-contacts">
                <Text variant="caption" color="$colorMuted">
                  {t("listingViaLead")}
                </Text>
                {via.map((source) => {
                  const viaContactId = asContactId(
                    contactsByNpub.get(encodeNpub(source.pubkey))?.id,
                  );
                  return viaContactId ? (
                    <ListRow
                      key={source.pubkey}
                      leading={
                        <Avatar
                          name={source.name}
                          uri={source.pictureUrl ?? undefined}
                          size="sm"
                        />
                      }
                      title={source.name}
                      trailing={
                        <Icon name="Reply" size="sm" color="$colorMuted" />
                      }
                      chevron={false}
                      onPress={() => attachListingToChat(viaContactId, shared)}
                      testID="listing-ask-via"
                    />
                  ) : null;
                })}
              </Stack>
            ) : null}
          </>
        )}
      </Stack>
    </Stack>
  );
}
