import { Avatar, Row, Spinner, Stack, Text, TextField } from "@linky-fit/ui";
import type { ReactNode } from "react";
import { copy } from "../copy";
import { shortNpub } from "../format";
import { usePayerProfile } from "../services/react";
import type { ContactState } from "./contactState";

/**
 * A Linky contact by name, address or npub, with the profile it resolved
 * to (picture, name, address) under the field.
 */
export function ContactField({
  value,
  onChangeText,
  state,
  label = copy.contact.label,
  placeholder = copy.contact.placeholder,
  hint,
  error,
  trailing,
  testID,
}: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly state: ContactState;
  readonly label?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly hint?: string | undefined;
  readonly error: string | undefined;
  /** Shown at the field's end while nothing is being looked up. */
  readonly trailing?: ReactNode;
  readonly testID: string;
}) {
  const contact = state.kind === "resolved" ? state.contact : null;
  const profile = usePayerProfile(contact?.pubkey ?? null);
  const name =
    profile?.name ??
    contact?.address ??
    (contact === null ? "" : shortNpub(contact.pubkey));
  return (
    <Stack gap="$sm">
      <TextField
        testID={testID}
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        hint={hint}
        error={error}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        spellCheck={false}
        trailing={state.kind === "resolving" ? <Spinner size="sm" /> : trailing}
      />
      {contact !== null ? (
        <Row gap="$md" alignItems="center" testID={`${testID}-resolved`}>
          <Avatar
            name={name}
            uri={profile?.picture ?? undefined}
            icon={profile?.name ? undefined : "User"}
          />
          <Stack gap="$none" flexShrink={1}>
            <Text variant="label">{name}</Text>
            {profile?.name && contact.address !== null ? (
              <Text color="$colorMuted">{contact.address}</Text>
            ) : null}
          </Stack>
        </Row>
      ) : null}
    </Stack>
  );
}
