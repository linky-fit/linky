import { EmptyState, ListRow, Stack, TextField } from "@linky-fit/ui";
import React from "react";
import {
  contactSummaryLabel,
  type ContactSummary,
} from "../app/hooks/contacts/useContactSummaries";
import { useTranslation } from "../app/hooks/shell";
import { ContactSummaryAvatar } from "./ContactSummaryAvatar";

export interface PinnedContactPick {
  contact: ContactSummary;
  /** Why the row sits on top, e.g. what picking it supports. */
  description: string;
  testID?: string | undefined;
}

interface ContactPickerProps {
  contacts: Iterable<ContactSummary>;
  label: string;
  emptyTitle: string;
  onPick: (contact: ContactSummary) => void;
  /** A row above the saved contacts, kept out of the sort and search. */
  pinned?: PinnedContactPick | undefined;
  rowTestID?: string;
}

/** A searchable list of saved contacts, sorted by name, that picks one. */
export function ContactPicker({
  contacts,
  label,
  emptyTitle,
  onPick,
  pinned,
  rowTestID = "contact-picker-contact",
}: ContactPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const query = search.trim().toLowerCase();
  const shown = Array.from(contacts)
    .filter(
      (candidate) =>
        candidate.id !== pinned?.contact.id &&
        (!query ||
          [candidate.name, candidate.lnAddress, candidate.npub].some((value) =>
            value?.toLowerCase().includes(query),
          )),
    )
    .sort((a, b) =>
      contactSummaryLabel(a).localeCompare(contactSummaryLabel(b)),
    );
  return (
    <Stack gap="$md">
      <TextField
        label={label}
        value={search}
        onChangeText={setSearch}
        placeholder={t("contactsSearchPlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      {pinned && !query ? (
        <ListRow
          testID={pinned.testID}
          leading={<ContactSummaryAvatar contact={pinned.contact} />}
          title={contactSummaryLabel(pinned.contact)}
          description={pinned.description}
          onPress={() => onPick(pinned.contact)}
        />
      ) : null}
      {shown.length === 0 ? (
        pinned && !query ? null : (
          <EmptyState title={emptyTitle} />
        )
      ) : (
        <Stack gap="$xs">
          {shown.map((candidate) => (
            <ListRow
              key={candidate.id}
              testID={rowTestID}
              leading={<ContactSummaryAvatar contact={candidate} />}
              title={contactSummaryLabel(candidate)}
              description={
                candidate.name && candidate.lnAddress
                  ? candidate.lnAddress
                  : undefined
              }
              onPress={() => onPick(candidate)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
