import {
  Avatar,
  BrandMark,
  Button,
  Icon,
  ListRow,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { ContactSearchCandidate } from "../app/hooks/contacts/useContactCandidates";
import { useVerifiedNip05 } from "../app/hooks/contacts/useVerifiedNip05";
import type { Translate } from "../i18n";
import {
  formatShortLightningAddress,
  formatShortNpub,
} from "../utils/formatting";

interface ContactSearchCandidateRowProps {
  candidate: ContactSearchCandidate;
  isSavingContact: boolean;
  /** Saves the candidate, or opens it when it is already a contact or the user. */
  onAdd: (candidate: ContactSearchCandidate) => void;
  /** Opens the candidate without saving it. */
  onOpen: (candidate: ContactSearchCandidate) => void;
  t: Translate;
  testID?: string;
}

/** A profile a contact search found: the row opens it, the button saves it. */
export function ContactSearchCandidateRow({
  candidate,
  isSavingContact,
  onAdd,
  onOpen,
  t,
  testID,
}: ContactSearchCandidateRowProps) {
  const displayName =
    (candidate.name || candidate.query || "").trim() || t("contact");
  const opens = Boolean(candidate.existingContactId || candidate.isSelf);
  const checkedNip05 = useVerifiedNip05(
    candidate.nip05Verified ? null : candidate.npub,
    candidate.nip05,
  );
  const verifiedNip05 = candidate.nip05Verified
    ? candidate.nip05
    : checkedNip05;
  const showLnAddress =
    Boolean(candidate.lnAddress) &&
    candidate.lnAddress.toLowerCase() !== verifiedNip05?.toLowerCase();
  return (
    <ListRow
      testID={testID}
      accessibilityLabel={displayName}
      onPress={() => onOpen(candidate)}
      chevron={false}
      leading={
        <Avatar name={displayName} uri={candidate.pictureUrl ?? undefined} />
      }
      title={
        <Text fontWeight="$semibold" numberOfLines={1}>
          {displayName}
        </Text>
      }
      description={
        <Stack gap="$xxs">
          {verifiedNip05 ? (
            <Row gap="$xs" alignItems="center">
              <Text
                variant="caption"
                color="$colorMuted"
                numberOfLines={1}
                flexShrink={1}
              >
                {formatShortLightningAddress(verifiedNip05)}
              </Text>
              <Stack aria-label={t("verifiedNip05")} role="img">
                <Icon name="Check" size="sm" color="$accent" />
              </Stack>
            </Row>
          ) : null}
          {showLnAddress ? (
            <Text variant="caption" color="$colorMuted" numberOfLines={1}>
              {formatShortLightningAddress(candidate.lnAddress)}
            </Text>
          ) : null}
          <Text variant="caption" color="$colorMuted" numberOfLines={1}>
            {formatShortNpub(candidate.npub)}
          </Text>
        </Stack>
      }
      action={
        <Row gap="$sm" alignItems="center">
          {candidate.usesLinky ? (
            <BrandMark size="icon" accessibilityLabel={t("contactUsesLinky")} />
          ) : (
            <Stack aria-label={t("contactUsesNostr")} role="img">
              <Icon name="Nostr" color="$colorMuted" />
            </Stack>
          )}
          <Button
            icon={opens ? "User" : "UserPlus"}
            onPress={() => onAdd(candidate)}
            loading={isSavingContact}
          >
            {opens ? t("openContact") : t("saveContact")}
          </Button>
        </Row>
      }
    />
  );
}
