import { ContactId as ContactIdType } from "@linky-fit/linksync";
import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { ContactId } from "../../../evolu";
import { useRouting } from "../../../hooks/useRouting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  buildTopbar,
  buildTopbarRight,
  buildTopbarTitle,
} from "../../lib/topbarConfig";
import {
  activeContactGroupAtom,
  contactsSearchAtom,
} from "../../state/contacts/contactsList";
import { profileDraftAtom } from "../../state/contacts/profiles";
import { hiddenTransactionsShownAtom } from "../../state/shell/topbar";
import {
  useBackFromContactNew,
  useCloseContactDetail,
  useDeleteContact,
} from "../contacts/useContactActions";
import { useToggleContactsFilter } from "../contacts/useContactsList";
import {
  useChatContact,
  useRouteContact,
} from "../contacts/useDisplayContacts";
import { useTranslation } from "../shell";
import { useNavIntent } from "../shell/navIntents";
import { useScanCommands } from "../shell/scan";
import { useMainMenu } from "./useMainMenuState";

const parseContactId = (value: unknown): ContactId | null => {
  const result = ContactIdType.fromUnknown(value);
  return result.ok ? result.value : null;
};

/** The top bar's back button, trailing action, title and chat peer for the route. */
export const useTopbar = () => {
  const route = useRouting();
  const { t } = useTranslation();
  const closeContactDetail = useCloseContactDetail();
  const backFromContactNew = useBackFromContactNew();
  const deleteContact = useDeleteContact();
  const contactPayBackToChatId = useNavIntent("contactPayBackToChat");
  const { navigateToMainReturn, openMenu } = useMainMenu();
  const { openReceiveScan } = useScanCommands();
  const toggleContactsFilter = useToggleContactsFilter();
  const selectedChatContact = useChatContact(route);
  const selectedContact = useRouteContact(route);
  const contactsSearch = useAtomValue(contactsSearchAtom);
  const activeGroup = useAtomValue(activeContactGroupAtom);
  const isProfileEditing = useAtomValue(
    profileDraftAtom,
    (draft) => draft.editing,
  );
  const [hiddenTransactionsShown, setHiddenTransactionsShown] = useAtom(
    hiddenTransactionsShownAtom,
  );

  const topbar = buildTopbar({
    backFromContactNew,
    closeContactDetail,
    contactPayBackToChatId,
    navigateToMainReturn,
    route,
    t,
  });

  const topbarRight = buildTopbarRight({
    chatEditContactId:
      route.kind === "chat" && !selectedChatContact?.isUnknownContact
        ? parseContactId(selectedContact?.id)
        : null,
    contactsFilterIsActive:
      contactsSearch.trim() !== "" || activeGroup !== null,
    deleteEditedContact: () => {
      if (route.kind === "contactEdit") void deleteContact(route.id);
    },
    hiddenTransactionsShown,
    isProfileEditing,
    openReceiveScan,
    route,
    t,
    toggleContactsFilter,
    toggleHiddenTransactions: () =>
      setHiddenTransactionsShown((shown) => !shown),
    openMenu,
  });

  const chatTopbarContact =
    route.kind === "chat" && selectedChatContact
      ? {
          contactId: selectedChatContact.isUnknownContact
            ? null
            : parseContactId(selectedContact?.id),
          isUnknownContact: Boolean(selectedChatContact.isUnknownContact),
          name: (selectedChatContact.name ?? "").trim() || null,
          npub: normalizeNpubIdentifier(selectedChatContact.npub ?? ""),
        }
      : null;

  return {
    chatTopbarContact,
    topbar,
    topbarRight,
    topbarTitle: React.useMemo(() => buildTopbarTitle(route, t), [route, t]),
  };
};
