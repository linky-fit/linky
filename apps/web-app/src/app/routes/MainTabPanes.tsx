import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import { Stack } from "@linky-fit/ui";
import React from "react";
import { ContactCard } from "../../components/ContactCard";
import { ContactsChecklist } from "../../components/ContactsChecklist";
import {
  FloatingActionButton,
  floatingActionButtonClearance,
} from "../../components/FloatingActionButton";
import { useRouting } from "../../hooks/useRouting";
import { ContactsPage } from "../../pages/ContactsPage";
import { WalletPage } from "../../pages/WalletPage";
import { createContactNameFormatter } from "../../utils/contactName";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import { nowSeconds } from "../../utils/time";
import {
  useOpenContactDetail,
  useOpenNewContactPage,
} from "../hooks/contacts/useContactActions";
import { useContactsListView } from "../hooks/contacts/useContactsList";
import {
  useDisplayContacts,
  useNostrStatusByNpub,
  useNpubMessageContactInfo,
  type DisplayContact,
} from "../hooks/contacts/useDisplayContacts";
import { useNostrPictureByNpub } from "../hooks/contacts/useProfileCache";
import { useStartContactsGuide } from "../hooks/guide/useContactsGuideControls";
import { useContactsOnboarding } from "../hooks/guide/useContactsOnboarding";
import { useMintIcons } from "../hooks/mint/useMintInfo";
import { useTranslation } from "../hooks/shell";
import { useScanCommands, useScanIsOpen } from "../hooks/shell/scan";
import { useActiveBankPaymentOfferContacts } from "../hooks/useBankPaymentOffers";
import { useOpenFeedbackContact } from "../hooks/useFeedbackContact";
import { useCashuTokenMessageInfo } from "../hooks/wallet/useWalletInventory";
import { useTokenContactSend } from "../hooks/wallet/useWalletTokens";
import { parsePrivateImageMessage } from "../lib/privateImageMessage";
import {
  activeContactGroupAtom,
  contactsFilterOpenAtom,
  contactsSearchAtom,
  contactsSearchInputRefAtom,
  unreadByContactIdAtom,
} from "../state/contacts/contactsList";
import { lastVisibleMessageByContactIdAtom } from "../state/contacts/displayContacts";
import type { ContactRowLike, ContactsGuideKey } from "../types/appTypes";
import { getDesktopActiveContactId } from "./desktopRouteSection";

type ActiveBankPaymentOfferContacts = (nowSec: number) => {
  contactIds: ReadonlySet<string>;
  nextExpiryAtSec: number | null;
};

const isContactsGuideKey = (value: string): value is ContactsGuideKey =>
  value === "add_contact" ||
  value === "topup" ||
  value === "pay" ||
  value === "message" ||
  value === "backup_keys";

interface VisibleContactSections {
  conversations: ContactRowLike[];
  others: ContactRowLike[];
  pinned: ContactRowLike[];
  proxyPayments: ContactRowLike[];
}

const useVisibleContactSections = (
  activeBankPaymentOfferContacts: ActiveBankPaymentOfferContacts,
  visibleContacts: {
    conversations: ContactRowLike[];
    others: ContactRowLike[];
    pinned: ContactRowLike[];
  },
): VisibleContactSections => {
  const [nowSec, setNowSec] = React.useState(() => nowSeconds());
  const activeOffers = React.useMemo(
    () => activeBankPaymentOfferContacts(nowSec),
    [activeBankPaymentOfferContacts, nowSec],
  );

  React.useEffect(() => {
    if (activeOffers.nextExpiryAtSec === null) return;
    const timeoutId = setTimeout(
      () => setNowSec(nowSeconds()),
      Math.max(0, activeOffers.nextExpiryAtSec * 1_000 - Date.now() + 25),
    );
    return () => clearTimeout(timeoutId);
  }, [activeOffers.nextExpiryAtSec]);

  return React.useMemo(() => {
    const isProxyPaymentContact = (contact: ContactRowLike): boolean =>
      contact.isUnknownContact !== true &&
      activeOffers.contactIds.has((contact.id ?? "").trim());
    const proxyPayments = [
      ...visibleContacts.pinned,
      ...visibleContacts.conversations,
      ...visibleContacts.others,
    ].filter(isProxyPaymentContact);

    return {
      conversations: visibleContacts.conversations.filter(
        (contact) => !isProxyPaymentContact(contact),
      ),
      others: visibleContacts.others.filter(
        (contact) => !isProxyPaymentContact(contact),
      ),
      pinned: visibleContacts.pinned.filter(
        (contact) => !isProxyPaymentContact(contact),
      ),
      proxyPayments,
    };
  }, [activeOffers.contactIds, visibleContacts]);
};

/** A contact row with its last message and avatar; picking it sends a pending token there. */
const useContactCardRenderer = () => {
  const route = useRouting();
  const { displayContactById } = useDisplayContacts();
  const nostrPictureByNpub = useNostrPictureByNpub();
  const nostrStatusByNpub = useNostrStatusByNpub();
  const lastMessageByContactId = useAtomValue(
    lastVisibleMessageByContactIdAtom,
  );
  const unreadByContactId = useAtomValue(unreadByContactIdAtom);
  const getCashuTokenMessageInfo = useCashuTokenMessageInfo();
  const { getMintIconUrl, markMintIconFailed } = useMintIcons();
  const getNpubMessageContactInfo = useNpubMessageContactInfo();
  const { pendingCashuTokenContactPickId, sendCashuTokenToContact } =
    useTokenContactSend();
  const openContactDetail = useOpenContactDetail();

  const formatContactName = React.useMemo(
    () => createContactNameFormatter(Array.from(displayContactById.values())),
    [displayContactById],
  );

  const handleSelectContact = React.useCallback(
    (contact: DisplayContact) => {
      if (pendingCashuTokenContactPickId) {
        void sendCashuTokenToContact(contact, pendingCashuTokenContactPickId);
        return;
      }
      openContactDetail(contact);
    },
    [
      openContactDetail,
      pendingCashuTokenContactPickId,
      sendCashuTokenToContact,
    ],
  );

  return React.useCallback(
    (row: ContactRowLike): React.ReactNode => {
      const id = (row.id ?? "").trim();
      const contact = id ? displayContactById.get(id) : undefined;
      if (!contact) return null;
      const npub = normalizeNpubIdentifier(contact.npub ?? "");
      const last = lastMessageByContactId.get(id);
      const lastText = (last?.content ?? "").trim();
      return (
        <ContactCard
          key={contact.id ?? ""}
          contact={contact}
          nameLabel={formatContactName(contact)}
          avatarUrl={npub ? nostrPictureByNpub[npub] : null}
          lastMessage={last ?? null}
          hasAttention={unreadByContactId.has(id)}
          isActive={(contact.id ?? "") === getDesktopActiveContactId(route)}
          isUnknownContact={Boolean(contact.isUnknownContact)}
          statusText={npub ? (nostrStatusByNpub[npub] ?? null) : null}
          tokenInfo={
            lastText && !parsePrivateImageMessage(lastText)
              ? getCashuTokenMessageInfo(lastText)
              : null
          }
          getMintIconUrl={getMintIconUrl}
          getNpubMessageContactInfo={getNpubMessageContactInfo}
          onSelect={handleSelectContact}
          onMintIconError={markMintIconFailed}
        />
      );
    },
    [
      displayContactById,
      formatContactName,
      getCashuTokenMessageInfo,
      getMintIconUrl,
      getNpubMessageContactInfo,
      handleSelectContact,
      lastMessageByContactId,
      markMintIconFailed,
      nostrPictureByNpub,
      nostrStatusByNpub,
      route,
      unreadByContactId,
    ],
  );
};

const ContactsContent = ({
  filterAlwaysOpen,
}: {
  filterAlwaysOpen: boolean;
}): React.ReactElement => {
  const { t } = useTranslation();
  const [activeGroup, setActiveGroup] = useAtom(activeContactGroupAtom);
  const [contactsSearch, setContactsSearch] = useAtom(contactsSearchAtom);
  const contactsFilterOpen = useAtomValue(contactsFilterOpenAtom);
  const contactsSearchInputRef = useAtomValue(contactsSearchInputRefAtom);
  const { contactFilterOptions, showGroupFilter, visibleContacts } =
    useContactsListView();
  const {
    contactsOnboardingCelebrating,
    contactsOnboardingTasks,
    dismissContactsOnboarding,
    showContactsOnboarding,
  } = useContactsOnboarding();
  const startContactsGuide = useStartContactsGuide();
  const renderContactCard = useContactCardRenderer();
  const visibleContactSections = useVisibleContactSections(
    useActiveBankPaymentOfferContacts(),
    visibleContacts,
  );

  return (
    <ContactsPage
      onboardingContent={
        showContactsOnboarding ? (
          <ContactsChecklist
            contactsOnboardingCelebrating={contactsOnboardingCelebrating}
            dismissContactsOnboarding={dismissContactsOnboarding}
            onShowHow={(key) => {
              if (!isContactsGuideKey(key)) return;
              startContactsGuide(key);
            }}
            progressPercent={contactsOnboardingTasks.percent}
            t={t}
            tasks={contactsOnboardingTasks.tasks}
            tasksCompleted={contactsOnboardingTasks.done}
            tasksTotal={contactsOnboardingTasks.total}
          />
        ) : null
      }
      contactsSearchInputRef={contactsSearchInputRef}
      contactsSearch={contactsSearch}
      filterOpen={contactsFilterOpen || filterAlwaysOpen}
      setContactsSearch={setContactsSearch}
      showGroupFilter={
        showGroupFilter || (filterAlwaysOpen && contactFilterOptions.length > 0)
      }
      activeGroup={activeGroup}
      setActiveGroup={setActiveGroup}
      filterOptions={contactFilterOptions}
      visibleContacts={visibleContactSections}
      conversationsLabel={t("conversations")}
      otherContactsLabel={t("otherContacts")}
      renderContactCard={renderContactCard}
      t={t}
    />
  );
};

const AddContactButton = (): React.ReactElement => {
  const { t } = useTranslation();
  const openNewContactPage = useOpenNewContactPage();
  return (
    <FloatingActionButton
      icon="UserPlus"
      label={t("addContact")}
      onPress={openNewContactPage}
      guide="contact-add-button"
    />
  );
};

export const ContactsPane = (): React.ReactElement => (
  <>
    <Stack paddingBottom={floatingActionButtonClearance}>
      <ContactsContent filterAlwaysOpen={false} />
    </Stack>
    <AddContactButton />
  </>
);

export const DesktopContactsPane = (): React.ReactElement => (
  <>
    <ContactsContent filterAlwaysOpen />
    <AddContactButton />
  </>
);

export const WalletPane = (): React.ReactElement => {
  const openFeedbackContact = useOpenFeedbackContact();
  const { openWalletScan } = useScanCommands();
  const scanIsOpen = useScanIsOpen();
  return (
    <WalletPage
      openFeedbackContact={openFeedbackContact}
      openScan={openWalletScan}
      scanIsOpen={scanIsOpen}
    />
  );
};
