import { Button, ContactRow, Section, Stack, TextField } from "@linky-fit/ui";
import React, { type FC } from "react";
import type { ContactId } from "../evolu";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatMiddleDots } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";

interface ManualPayContact {
  id: ContactId;
  lnAddress?: string | null;
  name?: string | null;
  npub?: string | null;
}

interface ManualPayPageProps {
  contacts: readonly ManualPayContact[];
  nostrPictureByNpub: Record<string, string | null>;
  onSubmitText: (text: string) => Promise<void>;
  t: Translate;
}

const scanLikePrefix =
  /^(lnbc|lntb|lnbcrt|lnurl|cashu|creq|npub|nprofile|nevent|note|nostr)/i;
const linkyAliasPattern = /^[a-z0-9._-]+$/i;

const normalizeSearch = (value: string | null | undefined): string =>
  (value ?? "").trim().toLocaleLowerCase();

const getLightningLocalPart = (
  value: string | null | undefined,
): string | null => {
  const normalized = (value ?? "").trim();
  const at = normalized.indexOf("@");
  if (at <= 0) return null;
  return normalized.slice(0, at);
};

const shouldTryLinkyAlias = (raw: string): boolean => {
  const value = raw.trim();
  if (!value) return false;
  if (value.includes("@") || value.includes(":") || value.includes("/")) {
    return false;
  }
  if (scanLikePrefix.test(value)) return false;
  return linkyAliasPattern.test(value);
};

const contactSearchFields = (contact: ManualPayContact): string[] => {
  const lnAddress = (contact.lnAddress ?? "").trim();
  const lnLocal = getLightningLocalPart(lnAddress);
  return [
    (contact.name ?? "").trim(),
    lnAddress,
    (lnLocal ?? "").trim(),
    (contact.npub ?? "").trim(),
  ].filter((field) => field.length > 0);
};

// A typed name or npub picks the contact; a lightning address is paid as itself.
const findExactContact = (
  contacts: readonly ManualPayContact[],
  query: string,
): ManualPayContact | null => {
  const needle = normalizeSearch(query);
  if (!needle) return null;

  return (
    contacts.find((contact) =>
      [contact.name, contact.npub].some(
        (field) => normalizeSearch(field) === needle,
      ),
    ) ?? null
  );
};

export const ManualPayPage: FC<ManualPayPageProps> = ({
  contacts,
  nostrPictureByNpub,
  onSubmitText,
  t,
}) => {
  const [value, setValue] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const query = value.trim();
  const normalizedQuery = normalizeSearch(query);
  const expandedAlias = shouldTryLinkyAlias(query)
    ? `${query}@linky.fit`
    : null;

  const suggestions = React.useMemo(() => {
    if (!normalizedQuery) return [];

    return contacts
      .filter((contact) =>
        contactSearchFields(contact).some((field) =>
          normalizeSearch(field).includes(normalizedQuery),
        ),
      )
      .slice(0, 5);
  }, [contacts, normalizedQuery]);

  const submit = async () => {
    if (!query || isSubmitting) return;

    const exactContact = findExactContact(contacts, query);
    if (exactContact) {
      navigateTo({ route: "contactPay", id: exactContact.id });
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitText(expandedAlias ?? query);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Stack gap="$xl">
      <Stack gap="$md">
        <TextField
          id="manual-pay-input"
          label={t("manualPayLabel")}
          autoFocus
          inputMode="text"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("manualPayPlaceholder")}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={() => void submit()}
          hint={
            expandedAlias
              ? t("manualPayLinkyAliasHint").replace("{address}", expandedAlias)
              : undefined
          }
        />
        <Button disabled={!query || isSubmitting} onPress={() => void submit()}>
          {t("manualPayContinue")}
        </Button>
      </Stack>

      {suggestions.length > 0 ? (
        <Section title={t("manualPaySuggestions")}>
          {suggestions.map((contact) => {
            const npub = normalizeNpubIdentifier(contact.npub ?? "");
            const pictureUrl = npub ? nostrPictureByNpub[npub] : null;
            const name = (contact.name ?? "").trim();
            const subtitle =
              (contact.lnAddress ?? "").trim() || (contact.npub ?? "").trim();

            return (
              <ContactRow
                key={contact.id}
                name={name || t("contact")}
                avatarUri={pictureUrl ?? undefined}
                preview={subtitle ? formatMiddleDots(subtitle, 34) : undefined}
                onPress={() =>
                  navigateTo({ route: "contactPay", id: contact.id })
                }
              />
            );
          })}
        </Section>
      ) : null}
    </Stack>
  );
};
