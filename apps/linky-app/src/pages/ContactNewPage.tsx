import { encodeNpub, type Pubkey } from "@linky-fit/linkstr";
import {
  Avatar,
  Button,
  Chip,
  IconButton,
  ListRow,
  LoadingState,
  NearbyAvatar,
  type NearbyBadge,
  NearbyRow,
  nearbyRowCapacity,
  Notice,
  Row,
  ScrollView,
  Section,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import { useAtomValue } from "@linky-fit/linkstr-react";
import type { FC } from "react";
import React from "react";
import {
  useContactEditor,
  useContactEditorParams,
} from "../app/hooks/contacts/useContactEditor";
import { useTranslation } from "../app/hooks/shell";
import { useScanCommands } from "../app/hooks/shell/scan";
import { contactGroupsAtom } from "../app/state/contacts/readModel";
import type { Route } from "../types/route";
import { useIdentityScan, useNearbyIdentities } from "../app/hooks/useBeacon";
import { getContactQueryPrefill } from "../app/lib/contactQueryPrefill";
import type { ContactNewStep } from "../app/types/appTypes";
import { isLightningAddress } from "../lnurlPay";

import type { Translate } from "../i18n";
import { keepInputFocus } from "../utils/keepInputFocus";
import { readClipboardText } from "../platform/clipboard";
import { normalizeContactGroups } from "../utils/contactGroups";
import {
  firstName,
  formatShortLightningAddress,
  formatShortNpub,
} from "../utils/formatting";
import { guideTarget } from "../app/lib/guideTargets";

export interface ContactFormData {
  name: string;
  npub: string;
  lnAddress: string;
  groups: string[];
}

interface ContactFieldsProps {
  form: ContactFormData;
  groupNames: string[];
  includeNpub?: boolean;
  lightningAction?: React.ReactNode;
  lightningPlaceholder?: string;
  /** Shown inside the field when the typed value differs from it. */
  lightningPublicValue?: string;
  nameAction?: React.ReactNode;
  namePlaceholder?: string;
  namePublicValue?: string;
  setForm: (value: ContactFormData) => void;
  t: Translate;
}

export function ContactFields({
  form,
  groupNames,
  includeNpub = false,
  lightningAction,
  lightningPlaceholder,
  lightningPublicValue,
  nameAction,
  namePlaceholder,
  namePublicValue,
  setForm,
  t,
}: ContactFieldsProps) {
  const [groupInput, setGroupInput] = React.useState("");
  const allGroups = normalizeContactGroups([...form.groups, ...groupNames]);
  const addGroup = (value: string) => {
    const groups = normalizeContactGroups([...form.groups, value]);
    if (groups.length === form.groups.length) return;
    setForm({ ...form, groups });
    setGroupInput("");
  };
  const removeGroup = (value: string) => {
    setForm({
      ...form,
      groups: form.groups.filter((group) => group !== value),
    });
  };
  const publicValueAndAction = (
    publicValue: string | undefined,
    action: React.ReactNode,
  ) =>
    action ? (
      <Row gap="$xs" flexShrink={1}>
        {publicValue ? (
          <Text
            variant="caption"
            color="$colorMuted"
            numberOfLines={1}
            flexShrink={1}
          >
            {publicValue}
          </Text>
        ) : null}
        {action}
      </Row>
    ) : (
      publicValue
    );

  return (
    <Stack gap="$md">
      <TextField
        label={t("name")}
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
        placeholder={namePlaceholder ?? t("namePlaceholder")}
        trailing={publicValueAndAction(namePublicValue, nameAction)}
      />

      {includeNpub ? (
        <TextField
          label={t("npub")}
          value={form.npub}
          onChange={(event) => setForm({ ...form, npub: event.target.value })}
          placeholder={t("npubPlaceholder")}
        />
      ) : null}

      <TextField
        label={t("lightningAddress")}
        value={form.lnAddress}
        onChange={(event) =>
          setForm({ ...form, lnAddress: event.target.value })
        }
        placeholder={lightningPlaceholder ?? t("lightningAddressPlaceholder")}
        trailing={publicValueAndAction(lightningPublicValue, lightningAction)}
      />

      <Stack gap="$xs" {...guideTarget("contact-group")}>
        <Text variant="label" color="$colorSubtle">
          {t("group")}
        </Text>
        {allGroups.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row gap="$sm" role="group" aria-label={t("group")}>
              {allGroups.map((group) => {
                const isSelected = form.groups.includes(group);
                return (
                  <Chip
                    key={group}
                    label={group}
                    selected={isSelected}
                    onPress={() =>
                      isSelected ? removeGroup(group) : addGroup(group)
                    }
                  />
                );
              })}
            </Row>
          </ScrollView>
        ) : null}
        <TextField
          label={t("group")}
          hideLabel
          value={groupInput}
          onChange={(event) => setGroupInput(event.target.value)}
          onBlur={() => addGroup(groupInput)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            addGroup(groupInput);
          }}
          placeholder={t("groupPlaceholder")}
        />
      </Stack>
    </Stack>
  );
}

interface ContactSearchCandidate {
  existingContactId?: string;
  isSelf?: boolean;
  isExactMatch: boolean;
  lnAddress: string;
  name: string;
  npub: string;
  pictureUrl: string | null;
  query: string;
}

interface ContactSuggestionCandidate extends Omit<
  ContactSearchCandidate,
  "isExactMatch"
> {
  displayLnAddress: string;
}

type ContactSearchResult =
  | { kind: "empty" }
  | { kind: "error"; identifier: string }
  | { kind: "found"; contacts: ContactSearchCandidate[] }
  | { kind: "not_found"; query: string };

interface ContactSearchResults {
  contacts: ContactSearchCandidate[];
  query: string;
}

/** Suggested people shown until the row is measured. */
const DEFAULT_SUGGESTED_PEOPLE = 3;

interface SearchCandidateRowProps {
  candidate: ContactSearchCandidate;
  isSavingContact: boolean;
  onAdd: (candidate: ContactSearchCandidate) => Promise<void>;
  t: Translate;
  testID?: string;
}

function SearchCandidateRow({
  candidate,
  isSavingContact,
  onAdd,
  t,
  testID,
}: SearchCandidateRowProps) {
  const displayName =
    (candidate.name || candidate.query || "").trim() || t("contact");
  const opens = Boolean(candidate.existingContactId || candidate.isSelf);
  return (
    <ListRow
      testID={testID}
      selected={candidate.isExactMatch}
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
          {candidate.lnAddress ? (
            <Text variant="caption" color="$colorMuted" numberOfLines={1}>
              {formatShortLightningAddress(candidate.lnAddress)}
            </Text>
          ) : null}
          <Text variant="caption" color="$colorMuted" numberOfLines={1}>
            {formatShortNpub(candidate.npub)}
          </Text>
        </Stack>
      }
      trailing={
        <Button
          icon={opens ? "User" : "UserPlus"}
          onPress={() => void onAdd(candidate)}
          loading={isSavingContact}
        >
          {opens ? t("openContact") : t("saveContact")}
        </Button>
      }
    />
  );
}

/**
 * Nearby npubs as search candidates; each is looked up once, and shows as its short npub until its profile arrives.
 * An npub query is an exact kind-0 lookup only, so who was nearby never reaches a search relay.
 */
const useNearbyCandidates = (
  pubkeys: ReadonlyArray<Pubkey>,
  searchNewContact: ContactNewPageProps["searchNewContact"],
): ContactSearchCandidate[] => {
  const [found, setFound] = React.useState<
    ReadonlyMap<string, ContactSearchCandidate>
  >(new Map());
  const requested = React.useRef(new Set<string>());

  React.useEffect(() => {
    for (const pubkey of pubkeys) {
      const npub = encodeNpub(pubkey);
      if (requested.current.has(npub)) continue;
      requested.current.add(npub);
      const show = (result: ContactSearchResult) => {
        const candidate =
          result.kind === "found"
            ? result.contacts.find((contact) => contact.npub === npub)
            : undefined;
        if (candidate)
          setFound((current) =>
            new Map(current).set(npub, {
              ...candidate,
              isExactMatch: false,
              query: formatShortNpub(npub),
            }),
          );
      };
      void searchNewContact(npub, show).then(show);
    }
  }, [pubkeys, searchNewContact]);

  return pubkeys.map((pubkey) => {
    const npub = encodeNpub(pubkey);
    return (
      found.get(npub) ?? {
        isExactMatch: false,
        lnAddress: "",
        name: "",
        npub,
        pictureUrl: null,
        query: formatShortNpub(npub),
      }
    );
  });
};

interface ContactNewPageProps {
  addNewContactFromSearchResult: (
    candidate: ContactSearchCandidate,
  ) => Promise<void>;
  contactSuggestions: readonly ContactSuggestionCandidate[];
  form: ContactFormData;
  groupNames: string[];
  handleSaveContact: () => void;
  isSavingContact: boolean;
  openScan: () => void;
  setStep: (step: ContactNewStep) => void;
  step: ContactNewStep;
  searchNewContact: (
    query?: string,
    onProgress?: (result: ContactSearchResult) => void,
  ) => Promise<ContactSearchResult>;
  setForm: (value: ContactFormData) => void;
  t: Translate;
}

export const ContactNewPage: FC<ContactNewPageProps> = ({
  addNewContactFromSearchResult,
  contactSuggestions,
  form,
  groupNames,
  handleSaveContact,
  isSavingContact,
  openScan,
  searchNewContact,
  setForm,
  setStep,
  step,
  t,
}) => {
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchIsBusy, setSearchIsBusy] = React.useState(false);
  const [searchResults, setSearchResults] =
    React.useState<ContactSearchResults | null>(null);
  const [manualCreateQuery, setManualCreateQuery] = React.useState<
    string | null
  >(null);
  const lastSearchedQueryRef = React.useRef("");
  const searchQueryRef = React.useRef("");
  const searchRequestSeqRef = React.useRef(0);

  const searchQuery = form.npub.trim();
  const [rowWidth, setRowWidth] = React.useState<number | null>(null);
  useIdentityScan();
  const nearbyCandidates = useNearbyCandidates(
    useNearbyIdentities(),
    searchNewContact,
  );
  // Nearby people first, then new Linky users, each npub once, as many as fit beside each other.
  const suggestedPeople = React.useMemo(() => {
    const seen = new Set<string>();
    const people: {
      badge: NearbyBadge;
      candidate: ContactSearchCandidate;
    }[] = [];
    const add = (candidate: ContactSearchCandidate, badge: NearbyBadge) => {
      if (seen.has(candidate.npub)) return;
      seen.add(candidate.npub);
      people.push({ badge, candidate });
    };
    for (const candidate of nearbyCandidates)
      add(candidate, { label: t("nearby"), tone: "accent" });
    for (const suggestion of contactSuggestions)
      add(
        { ...suggestion, isExactMatch: false },
        { label: t("contactSuggestionNew"), tone: "neutral" },
      );
    return people.slice(
      0,
      rowWidth === null
        ? DEFAULT_SUGGESTED_PEOPLE
        : nearbyRowCapacity(rowWidth),
    );
  }, [contactSuggestions, nearbyCandidates, rowWidth, t]);
  const showSuggestedPeople = !searchQuery && suggestedPeople.length > 0;

  React.useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  React.useEffect(() => {
    if (form.lnAddress.trim()) {
      setStep("details");
    }
  }, [form.lnAddress, setStep]);

  const clearSearchFeedback = React.useCallback(() => {
    setSearchError(null);
    setSearchResults(null);
    setManualCreateQuery(null);
  }, []);

  const runSearch = React.useCallback(
    async (query = searchQuery, options?: { silentEmpty?: boolean }) => {
      const queryText = query.trim();
      if (!queryText) {
        if (!options?.silentEmpty) {
          setSearchError(t("contactSearchEmpty"));
        }
        setSearchResults(null);
        setManualCreateQuery(null);
        return;
      }

      const requestSeq = searchRequestSeqRef.current + 1;
      searchRequestSeqRef.current = requestSeq;
      lastSearchedQueryRef.current = queryText;
      setSearchIsBusy(true);
      clearSearchFeedback();
      const isCurrentRequest = () =>
        requestSeq === searchRequestSeqRef.current &&
        searchQueryRef.current === queryText;
      const showFound = (result: ContactSearchResult) => {
        if (!isCurrentRequest() || result.kind !== "found") return;
        setManualCreateQuery(null);
        setSearchResults({ contacts: result.contacts, query: queryText });
      };
      const result = await searchNewContact(queryText, showFound);

      if (requestSeq !== searchRequestSeqRef.current) return;
      setSearchIsBusy(false);
      if (searchQueryRef.current !== queryText) return;

      if (result.kind === "found") {
        showFound(result);
        return;
      }

      if (result.kind === "error") {
        setManualCreateQuery(null);
        setSearchError(
          t("nip05ResolveFailed").replace("{identifier}", result.identifier),
        );
        return;
      }

      if (result.kind === "not_found") {
        setSearchError(null);
        setManualCreateQuery(queryText);
      }
    },
    [clearSearchFeedback, searchNewContact, searchQuery, t],
  );

  const pasteSearch = async () => {
    const text = await readClipboardText();
    const queryText = (text ?? "").trim();
    if (!queryText) return;
    searchQueryRef.current = queryText;
    setForm({ ...form, npub: queryText });
    await runSearch(queryText);
  };

  React.useEffect(() => {
    if (step !== "search") return;
    if (!searchQuery) {
      setSearchResults(null);
      setManualCreateQuery(null);
      return;
    }

    if (searchResults?.query === searchQuery) return;
    if (lastSearchedQueryRef.current === searchQuery) return;

    const timer = setTimeout(() => {
      void runSearch(searchQuery, { silentEmpty: true });
    }, 900);

    return () => clearTimeout(timer);
  }, [runSearch, searchQuery, searchResults?.query, step]);

  const createManualFromSearch = () => {
    const prefill = getContactQueryPrefill(searchQuery);
    setForm({
      groups: [],
      lnAddress: prefill.lnAddress,
      name: prefill.name,
      npub: "",
    });
    clearSearchFeedback();
    setStep("details");
  };

  // A lightning address can be saved before any lookup settles; other queries only once nothing was found.
  const queryIsLightningAddress = isLightningAddress(searchQuery);
  const canCreateContactFromSearch =
    Boolean(searchQuery) &&
    (queryIsLightningAddress ||
      (!searchResults && manualCreateQuery === searchQuery && !searchIsBusy));
  // Stays visible under partial results until every lookup has settled.
  const showSearchLoader =
    Boolean(searchQuery) &&
    (searchIsBusy ||
      (!searchResults && !searchError && manualCreateQuery !== searchQuery));

  const searchStep = (
    <>
      <Text color="$colorMuted">{t("contactNewIntro")}</Text>

      <Button
        icon="ScanLine"
        onPress={openScan}
        disabled={isSavingContact}
        {...guideTarget("scan-contact-button")}
      >
        {t("contactLoadQr")}
      </Button>

      <TextField
        label={t("contactSearchLabel")}
        hideLabel
        value={form.npub}
        onChange={(event) => {
          lastSearchedQueryRef.current = "";
          clearSearchFeedback();
          setForm({ ...form, npub: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void runSearch();
        }}
        onPaste={(event) => {
          const queryText = event.clipboardData.getData("text").trim();
          if (!queryText) return;
          event.preventDefault();
          searchQueryRef.current = queryText;
          setForm({ ...form, npub: queryText });
          void runSearch(queryText);
        }}
        placeholder={t("contactSearchPlaceholder")}
        autoComplete="off"
        {...guideTarget("contact-search-input")}
        trailing={
          <IconButton
            icon="ClipboardPaste"
            size="sm"
            accessibilityLabel={t("paste")}
            onPointerDown={keepInputFocus}
            onPress={() => void pasteSearch()}
          />
        }
      />

      {canCreateContactFromSearch ? (
        <Button
          variant="secondary"
          alignSelf="flex-start"
          onPress={createManualFromSearch}
        >
          {queryIsLightningAddress
            ? t("contactSaveLightningAddress")
            : t("contactSearchCreateFromQuery")}
        </Button>
      ) : null}

      {searchResults ? (
        <Stack gap="$xs">
          {searchResults.contacts.map((candidate) => (
            <SearchCandidateRow
              key={candidate.npub}
              testID="contact-new-search-result"
              candidate={candidate}
              isSavingContact={isSavingContact}
              onAdd={addNewContactFromSearchResult}
              t={t}
            />
          ))}
        </Stack>
      ) : null}

      {searchError ? <Notice tone="danger" title={searchError} /> : null}

      {showSearchLoader ? <LoadingState label={t("contactSearching")} /> : null}

      {showSuggestedPeople ? (
        <Stack flexGrow={1} justifyContent="flex-end" paddingTop="$xxl">
          <Section title={t("contactSuggestionsTitle")}>
            <NearbyRow accessibilityLabel={t("contactSuggestionsTitle")}>
              {suggestedPeople.map(({ badge, candidate }) => {
                const displayName =
                  (candidate.name || candidate.query || "").trim() ||
                  t("contact");
                return (
                  <NearbyAvatar
                    key={candidate.npub}
                    name={displayName}
                    imageUrl={candidate.pictureUrl ?? undefined}
                    label={firstName(displayName)}
                    badge={badge}
                    onPress={() =>
                      void addNewContactFromSearchResult(candidate)
                    }
                  />
                );
              })}
            </NearbyRow>
          </Section>
        </Stack>
      ) : null}
    </>
  );

  return (
    <Stack
      gap="$md"
      minHeight="100%"
      onLayout={({ nativeEvent }) => {
        if (nativeEvent.layout.width > 0) setRowWidth(nativeEvent.layout.width);
      }}
    >
      {step === "search" ? (
        searchStep
      ) : (
        <>
          <ContactFields
            form={form}
            groupNames={groupNames}
            setForm={setForm}
            t={t}
          />

          <Row gap="$sm" flexWrap="wrap">
            <Button
              icon="Save"
              onPress={handleSaveContact}
              loading={isSavingContact}
            >
              {t("saveContact")}
            </Button>
          </Row>
        </>
      )}
    </Stack>
  );
};

export const ContactNewRoute: FC<{ route: Route }> = ({ route }) => {
  const { t } = useTranslation();
  const { groupNames } = useAtomValue(contactGroupsAtom);
  const { openScan } = useScanCommands();
  const editor = useContactEditor(useContactEditorParams(route));
  return (
    <ContactNewPage
      addNewContactFromSearchResult={editor.addNewContactFromSearchResult}
      contactSuggestions={editor.contactSuggestions}
      form={editor.form}
      groupNames={groupNames}
      handleSaveContact={editor.handleSaveContact}
      isSavingContact={editor.isSavingContact}
      openScan={openScan}
      searchNewContact={editor.searchNewContact}
      setForm={editor.setForm}
      setStep={editor.setContactNewStep}
      step={editor.contactNewStep}
      t={t}
    />
  );
};
