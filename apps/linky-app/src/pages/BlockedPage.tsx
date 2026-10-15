import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";
import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  Avatar,
  Button,
  EmptyState,
  ListRow,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useSetPubkeyBlocked } from "../app/hooks/contacts/useContactActions";
import { useContacts } from "../app/hooks/contacts/useDisplayContacts";
import { useSetStatus, useTranslation } from "../app/hooks/shell";
import { blockListAtom } from "../app/state/contacts/blockList";
import { profileCacheAtom } from "../app/state/contacts/profiles";
import { getContactName } from "../utils/contactName";
import { formatShortNpub, getBestNostrName } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

/** The block list, each entry named by its contact or profile, with unblock. */
export function BlockedPage(): React.ReactElement {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const contacts = useContacts();
  const profiles = useAtomValue(profileCacheAtom);
  const setPubkeyBlocked = useSetPubkeyBlocked();
  const blocked = useAtomValue(blockListAtom);

  const contactNameByNpub = new Map(
    contacts.flatMap((contact) => {
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      const name = getContactName(contact);
      return npub && name ? [[npub, name] as const] : [];
    }),
  );

  const unblock = (pubkey: Pubkey) => {
    setPubkeyBlocked(pubkey, false);
    setStatus(t("unblocked"));
  };

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t("blockedIntro")}</Text>
      {blocked.length === 0 ? (
        <EmptyState title={t("blockedEmpty")} />
      ) : (
        <Stack>
          {blocked.map((pubkey) => {
            const npub = encodeNpub(pubkey);
            const metadata = profiles.metadataByNpub[npub];
            const name =
              contactNameByNpub.get(npub) ??
              (metadata ? getBestNostrName(metadata) : null) ??
              formatShortNpub(npub);
            return (
              <ListRow
                key={pubkey}
                title={name}
                leading={
                  <Avatar
                    name={name}
                    uri={profiles.pictureByNpub[npub] ?? undefined}
                  />
                }
                testID={`blocked-${pubkey}`}
                trailing={
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => unblock(pubkey)}
                  >
                    {t("unblock")}
                  </Button>
                }
              />
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
