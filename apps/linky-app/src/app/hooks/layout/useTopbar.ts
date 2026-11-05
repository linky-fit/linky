import { useChatIdOfMessage } from "../useSharedListing";
import { ContactId as ContactIdType } from "@linky-fit/linksync";
import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import type { ContactId } from "../../../evolu";
import { useRouting } from "../../../hooks/useRouting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  buildTopbar,
  buildTopbarLeading,
  buildTopbarRight,
  buildTopbarTitle,
} from "../../lib/topbarConfig";
import {
  activeContactGroupAtom,
  contactsSearchAtom,
} from "../../state/contacts/contactsList";
import { profileDraftAtom } from "../../state/contacts/profiles";
import { currentPubkeyAtom } from "../../state/session/session";
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
import {
  useOnchainTransfers,
  usePendingOnchainTransfersLink,
} from "../useOnchainTransfers";
import { useMainMenu } from "./useMainMenuState";

const parseContactId = (value: unknown): ContactId | null => {
  const result = ContactIdType.fromUnknown(value);
  return result.ok ? result.value : null;
};

/** The top bar's back button, root-screen actions, title and chat peer for the route. */
export const useTopbar = () => {
  const route = useRouting();
  const { t } = useTranslation();
  const closeContactDetail = useCloseContactDetail();
  const backFromContactNew = useBackFromContactNew();
  const deleteContact = useDeleteContact();
  const contactPayBackToChatId = useNavIntent("contactPayBackToChat");
  const ownPubkey = useAtomValue(currentPubkeyAtom);
  const sharedListingChatId = useChatIdOfMessage(
    route.kind === "listing" ? route.messageId : null,
  );
  const { navigateToMainReturn, openMenu } = useMainMenu();
  const { openReceiveScan, openScan, openWalletScan } = useScanCommands();
  const toggleContactsFilter = useToggleContactsFilter();
  const selectedChatContact = useChatContact(route);
  const selectedContact = useRouteContact(route);
  const contactsSearch = useAtomValue(contactsSearchAtom);
  const activeGroup = useAtomValue(activeContactGroupAtom);
  const isProfileEditing = useAtomValue(
    profileDraftAtom,
    (draft) => draft.editing,
  );
  const pendingOnchainTransfers = usePendingOnchainTransfersLink();
  const onchainTransfers = useOnchainTransfers();
  const onchainTransferDirection =
    route.kind === "onchainTransfer"
      ? (onchainTransfers.find((transfer) => transfer.id === route.id)
          ?.direction ?? null)
      : null;
  const [hiddenTransactionsShown, setHiddenTransactionsShown] = useAtom(
    hiddenTransactionsShownAtom,
  );

  const topbar = buildTopbar({
    backFromContactNew,
    closeContactDetail,
    contactPayBackToChatId,
    navigateToMainReturn,
    ownPubkey,
    route,
    sharedListingChatId,
    t,
  });

  const topbarLeading = buildTopbarLeading({
    contactsFilterIsActive:
      contactsSearch.trim() !== "" || activeGroup !== null,
    isProfileEditing,
    pendingOnchainTransfers,
    route,
    t,
    toggleContactsFilter,
  });

  const topbarRight = buildTopbarRight({
    chatEditContactId:
      route.kind === "chat" && !selectedChatContact?.isUnknownContact
        ? parseContactId(selectedContact?.id)
        : null,
    deleteEditedContact: () => {
      if (route.kind === "contactEdit") void deleteContact(route.id);
    },
    hiddenTransactionsShown,
    isProfileEditing,
    openContactScan: openScan,
    openReceiveScan,
    openWalletScan,
    route,
    t,
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
    topbarLeading,
    topbarRight,
    topbarTitle: React.useMemo(
      () => buildTopbarTitle(route, t, onchainTransferDirection),
      [onchainTransferDirection, route, t],
    ),
  };
};
