import { EmptyState, ListRow, Stack, TextField } from "@linky-fit/ui";
import React from "react";
import {
  contactSummaryLabel,
  type ContactSummary,
} from "../app/hooks/contacts/useContactSummaries";
import { useTranslation } from "../app/hooks/shell";
import { ContactSummaryAvatar } from "./ContactSummaryAvatar";

interface ContactPickerProps {
  contacts: Iterable<ContactSummary>;
  label: string;
  emptyTitle: string;
  onPick: (contact: ContactSummary) => void;
  rowTestID?: string;
}

/** A searchable list of saved contacts, sorted by name, that picks one. */
export function ContactPicker({
  contacts,
  label,
  emptyTitle,
  onPick,
  rowTestID = "contact-picker-contact",
}: ContactPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const query = search.trim().toLowerCase();
  const shown = Array.from(contacts)
    .filter(
      (candidate) =>
        !query ||
        [candidate.name, candidate.lnAddress, candidate.npub].some((value) =>
          value?.toLowerCase().includes(query),
        ),
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
      {shown.length === 0 ? (
        <EmptyState title={emptyTitle} />
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
