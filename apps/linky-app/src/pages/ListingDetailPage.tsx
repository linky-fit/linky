import {
  encodeNpub,
  SharedListing,
  type Listing,
  type Pubkey,
} from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { ContactId, type MessageId } from "@linky-fit/linksync";
import {
  Avatar,
  Button,
  EmptyState,
  ListRow,
  Pill,
  Row,
  Section,
  Sheet,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useContactSummaries } from "../app/hooks/contacts/useContactSummaries";
import {
  useContacts,
  useNpubMessageContactInfo,
} from "../app/hooks/contacts/useDisplayContacts";
import { useSaveNpubContact } from "../app/hooks/contacts/useSaveNpubContact";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { useDisplayAmounts, useTranslation } from "../app/hooks/shell";
import { useListingRecords } from "../app/hooks/useLinksync";
import {
  useAttachListingToChat,
  useSharedListingOfMessage,
} from "../app/hooks/useSharedListing";
import { formatListingPrice, listingOfRecord } from "../app/lib/listings";
import { peerListingsAtom } from "../app/state/contacts/listings";
import { currentPubkeyAtom } from "../app/state/session/session";
import { ContactPicker } from "../components/ContactPicker";
import { ListingImage } from "../components/ListingImage";
import { navigateTo } from "../hooks/useRouting";
import { isDeletedContact } from "../utils/contactName";
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

/** The author's live listing: the own row, or what the author's document shares. */
const useLiveListing = (
  author: Pubkey,
  listingId: string,
  isOwn: boolean,
): Listing | null => {
  const records = useListingRecords();
  const peers = useAtomValue(peerListingsAtom);
  return React.useMemo(() => {
    if (isOwn) {
      const record = records.find((candidate) => candidate.id === listingId);
      return record ? listingOfRecord(record) : null;
    }
    return (
      peers[author]?.document.listings.find(
        (listing) => listing.id === listingId,
      ) ?? null
    );
  }, [author, isOwn, listingId, peers, records]);
};

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
  const live = useLiveListing(author, listingId, isOwn);
  const snapshot = useSharedListingOfMessage(messageId);
  const snapshotMatchesRoute =
    snapshot?.author === author && snapshot.listing.id === listingId;
  const shared = messageId
    ? snapshotMatchesRoute
      ? snapshot
      : null
    : live && new SharedListing({ author, listing: live });
  const authorNpub = encodeNpub(author);
  const contact =
    useContacts().find(
      (candidate) =>
        !isDeletedContact(candidate) &&
        normalizeNpubIdentifier(candidate.npub ?? "") === authorNpub,
    ) ?? null;
  const contactId = asContactId(contact?.id);
  const authorInfo = useNpubMessageContactInfo()(authorNpub);
  const saveNpubContact = useSaveNpubContact();
  const contactSummaries = useContactSummaries();
  const attachListingToChat = useAttachListingToChat();
  const [sharing, setSharing] = React.useState(false);

  if (!shared) {
    return <EmptyState icon="Package" title={t("listingNotFound")} />;
  }

  const { listing } = shared;
  const authorName = isOwn
    ? (ownProfile.effectiveProfileName ?? "")
    : (authorInfo?.displayName ?? "");
  const authorPicture = isOwn
    ? ownProfile.effectiveProfilePicture
    : authorInfo?.pictureUrl;
  const shareTargets = Array.from(contactSummaries.values()).filter(
    (candidate) => !candidate.deleted && candidate.npub !== null,
  );

  const shareButton = (
    <Button
      variant="secondary"
      icon="Share2"
      onPress={() => setSharing(true)}
      testID="listing-share"
    >
      {t("share")}
    </Button>
  );

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
        <Text variant="heading" role="heading">
          {listing.title}
        </Text>
        <Row gap="$sm" alignItems="baseline" flexWrap="wrap">
          <Text variant="title" bold testID="listing-price">
            {formatListingPrice(listing.amount, listing.currency, {
              displayCurrency,
              fiatRates,
              lang,
            })}
          </Text>
          <Text color="$colorMuted">{listing.unit}</Text>
        </Row>
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
      <Section grouped>
        <ListRow
          leading={
            <Avatar
              name={authorName}
              uri={authorPicture ?? undefined}
              size="md"
            />
          }
          title={isOwn ? t("listingYours") : authorName}
          description={
            isOwn || contact ? undefined : t("listingAuthorNotContact")
          }
          chevron={contactId !== null && !isOwn}
          onPress={
            contactId && !isOwn
              ? () => navigateTo({ route: "contact", id: contactId })
              : undefined
          }
          testID="listing-author"
        />
      </Section>
      <Stack gap="$sm">
        {isOwn ? (
          <>
            {live ? (
              <Button
                icon="Pencil"
                onPress={() =>
                  navigateTo({ route: "listingEdit", id: listingId })
                }
                testID="listing-edit"
              >
                {t("edit")}
              </Button>
            ) : null}
            {shareButton}
          </>
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
            ) : (
              <Button
                icon="UserPlus"
                onPress={() => saveNpubContact(authorNpub)}
                testID="listing-add-author"
              >
                {t("addContact")}
              </Button>
            )}
            {shareButton}
          </>
        )}
      </Stack>
      <Sheet
        open={sharing}
        onOpenChange={setSharing}
        title={t("listingShareTitle")}
      >
        <ContactPicker
          contacts={shareTargets}
          label={t("listingShareTo")}
          emptyTitle={t("listingShareNoContacts")}
          onPick={(picked) => {
            const pickedId = asContactId(picked.id);
            if (!pickedId) return;
            setSharing(false);
            attachListingToChat(pickedId, shared);
          }}
        />
      </Sheet>
    </Stack>
  );
}
