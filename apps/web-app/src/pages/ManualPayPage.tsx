import React, { type FC } from "react";
import { Avatar } from "../components/Avatar";
import type { ContactId } from "../evolu";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { formatMiddleDots, getInitials } from "../utils/formatting";
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

const findExactContact = (
  contacts: readonly ManualPayContact[],
  query: string,
): ManualPayContact | null => {
  const needle = normalizeSearch(query);
  if (!needle) return null;

  return (
    contacts.find((contact) =>
      contactSearchFields(contact).some(
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
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [value, setValue] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const query = value.trim();
  const normalizedQuery = normalizeSearch(query);
  const expandedAlias = shouldTryLinkyAlias(query)
    ? `${query}@linky.fit`
    : null;

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    <section className="panel panel-plain manual-pay-page">
      <form
        className="manual-pay-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="manual-pay-label" htmlFor="manual-pay-input">
          {t("manualPayLabel")}
        </label>
        <input
          id="manual-pay-input"
          ref={inputRef}
          type="text"
          inputMode="text"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("manualPayPlaceholder")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {expandedAlias ? (
          <p className="muted manual-pay-hint">
            {t("manualPayLinkyAliasHint").replace("{address}", expandedAlias)}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn-wide manual-pay-submit"
          disabled={!query || isSubmitting}
        >
          {t("manualPayContinue")}
        </button>
      </form>

      {suggestions.length > 0 ? (
        <div className="manual-pay-suggestions">
          <div className="muted manual-pay-suggestions-title">
            {t("manualPaySuggestions")}
          </div>
          <div className="contact-list">
            {suggestions.map((contact) => {
              const npub = normalizeNpubIdentifier(contact.npub ?? "");
              const pictureUrl = npub
                ? (nostrPictureByNpub[npub] ?? null)
                : null;
              const name = (contact.name ?? "").trim();
              const lnAddress = (contact.lnAddress ?? "").trim();
              const subtitle = lnAddress || (contact.npub ?? "").trim();

              return (
                <button
                  key={contact.id}
                  type="button"
                  className="contact-card is-clickable manual-pay-contact"
                  onClick={() =>
                    navigateTo({ route: "contactPay", id: contact.id })
                  }
                >
                  <div className="contact-avatar" aria-hidden="true">
                    <Avatar
                      pictureUrl={pictureUrl}
                      fallback={getInitials(name)}
                      fallbackClassName="contact-avatar-fallback"
                      loading="lazy"
                    />
                  </div>
                  <div className="contact-main">
                    <div className="contact-name">{name || t("contact")}</div>
                    {subtitle ? (
                      <div className="contact-meta">
                        {formatMiddleDots(subtitle, 34)}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
};
