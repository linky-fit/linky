import type { Translate } from "../../../i18n";
import type { Route } from "../../../types/route";
import { NPUB_CASH_SERVER_BASE_URL } from "../../../utils/npubCashServer";
import type { PeopleRoutesProps } from "../AppRouteContent";

interface BuildPeopleRoutePropsParams {
  cashuBalance: PeopleRoutesProps["chatProps"]["cashuBalance"];
  cashuBalanceAfterMelt: PeopleRoutesProps["chatProps"]["cashuBalanceAfterMelt"];
  cashuIsBusy: PeopleRoutesProps["chatProps"]["cashuIsBusy"];
  canWriteNfc: PeopleRoutesProps["profileProps"]["canWriteToNfc"];
  chatSelectedContact: PeopleRoutesProps["chatProps"]["selectedContact"];
  chatDraft: PeopleRoutesProps["chatProps"]["chatDraft"];
  chatMessageElByIdRef: PeopleRoutesProps["chatProps"]["chatMessageElByIdRef"];
  chatMessages: PeopleRoutesProps["chatProps"]["chatMessages"];
  bankPaymentOfferMessages: PeopleRoutesProps["chatProps"]["bankPaymentOfferMessages"];
  chatMessagesRef: PeopleRoutesProps["chatProps"]["chatMessagesRef"];
  chatOwnPubkeyHex: PeopleRoutesProps["chatProps"]["chatOwnPubkeyHex"];
  chatSendIsBusy: PeopleRoutesProps["chatProps"]["chatSendIsBusy"];
  contactEditsSavable: PeopleRoutesProps["contactEditProps"]["contactEditsSavable"];
  contactPaymentIntent: PeopleRoutesProps["contactPayProps"]["contactPaymentIntent"];
  contactPayMethod: PeopleRoutesProps["contactPayProps"]["contactPayMethod"];
  addNewContactFromSearchResult: PeopleRoutesProps["contactNewProps"]["addNewContactFromSearchResult"];
  contactSuggestions: PeopleRoutesProps["contactNewProps"]["contactSuggestions"];
  contacts: ReturnType<
    PeopleRoutesProps["bankPaymentOfferDetailProps"]
  >["contacts"];
  copyText: PeopleRoutesProps["profileProps"]["copyText"];
  currentNpub: PeopleRoutesProps["profileProps"]["currentNpub"];
  cycleProfileAvatarControl: PeopleRoutesProps["profileProps"]["cycleProfileAvatarControl"];
  derivedProfile: PeopleRoutesProps["profileProps"]["derivedProfile"];
  displayUnit: PeopleRoutesProps["contactPayProps"]["displayUnit"];
  editingId: PeopleRoutesProps["contactEditProps"]["editingId"];
  editContext: PeopleRoutesProps["chatProps"]["editContext"];
  effectiveMyLightningAddress: PeopleRoutesProps["profileProps"]["effectiveMyLightningAddress"];
  effectiveProfileName: PeopleRoutesProps["profileProps"]["effectiveProfileName"];
  effectiveProfilePicture: PeopleRoutesProps["profileProps"]["effectiveProfilePicture"];
  feedbackContactNpub: PeopleRoutesProps["chatProps"]["feedbackContactNpub"];
  form: PeopleRoutesProps["contactEditProps"]["form"];
  getCashuTokenMessageInfo: PeopleRoutesProps["chatProps"]["getCashuTokenMessageInfo"];
  getMintIconUrl: PeopleRoutesProps["chatProps"]["getMintIconUrl"];
  getNpubMessageContactInfo: PeopleRoutesProps["chatProps"]["getNpubMessageContactInfo"];
  groupNames: PeopleRoutesProps["contactEditProps"]["groupNames"];
  handleSaveContact: PeopleRoutesProps["contactEditProps"]["handleSaveContact"];
  isProfileEditing: PeopleRoutesProps["profileProps"]["isProfileEditing"];
  isSavingContact: PeopleRoutesProps["contactEditProps"]["isSavingContact"];
  blockArchivedContact: PeopleRoutesProps["contactEditProps"]["blockArchivedContact"];
  lang: PeopleRoutesProps["chatProps"]["lang"];
  mentionContacts: PeopleRoutesProps["chatProps"]["mentionContacts"];
  makeNip98AuthHeader: PeopleRoutesProps["profileProps"]["makeNip98AuthHeader"];
  myProfileQr: PeopleRoutesProps["profileProps"]["myProfileQr"];
  nostrPictureByNpub: PeopleRoutesProps["contactProps"]["nostrPictureByNpub"];
  onBlockUnknownContact: PeopleRoutesProps["chatProps"]["onBlockUnknownContact"];
  onCancelEdit: PeopleRoutesProps["chatProps"]["onCancelEdit"];
  onCancelReply: PeopleRoutesProps["chatProps"]["onCancelReply"];
  onAddUnknownContact: PeopleRoutesProps["chatProps"]["onAddUnknownContact"];
  onAddNpubContacts: PeopleRoutesProps["chatProps"]["onAddNpubContacts"];
  contactsGroupAssignment: PeopleRoutesProps["chatProps"]["contactsGroupAssignment"];
  onCopy: PeopleRoutesProps["chatProps"]["onCopy"];
  onDeclinePaymentRequest: PeopleRoutesProps["chatProps"]["onDeclinePaymentRequest"];
  onRespondBankPaymentOffer: ReturnType<
    PeopleRoutesProps["bankPaymentOfferDetailProps"]
  >["onRespondBankPaymentOffer"];
  onSettleBankPaymentOffer: PeopleRoutesProps["chatProps"]["onSettleBankPaymentOffer"];
  onEdit: PeopleRoutesProps["chatProps"]["onEdit"];
  onOpenNpubContact: PeopleRoutesProps["chatProps"]["onOpenNpubContact"];
  onPayPaymentRequest: PeopleRoutesProps["chatProps"]["onPayPaymentRequest"];
  onPickProfilePhoto: PeopleRoutesProps["profileProps"]["onPickProfilePhoto"];
  onProfilePhotoError: PeopleRoutesProps["profileProps"]["onProfilePhotoError"];
  onProfilePhotoSelected: PeopleRoutesProps["profileProps"]["onProfilePhotoSelected"];
  onReact: PeopleRoutesProps["chatProps"]["onReact"];
  onReply: PeopleRoutesProps["chatProps"]["onReply"];
  openContactPay: PeopleRoutesProps["chatProps"]["openContactPay"];
  ownedLightningAddresses: PeopleRoutesProps["profileProps"]["ownedLightningAddresses"];
  payAmount: PeopleRoutesProps["contactPayProps"]["payAmount"];
  payLightningInvoiceWithCashu: PeopleRoutesProps["profileProps"]["payLightningInvoiceWithCashu"];
  paySelectedContact: PeopleRoutesProps["contactPayProps"]["paySelectedContact"];
  payWithCashuEnabled: PeopleRoutesProps["chatProps"]["payWithCashuEnabled"];
  reactionsByMessageId: PeopleRoutesProps["chatProps"]["reactionsByMessageId"];
  route: Route;
  selectedContactStatusText: PeopleRoutesProps["contactProps"]["statusText"];
  pendingDeleteId: PeopleRoutesProps["contactEditProps"]["pendingDeleteId"];
  profileCustomPictureUrl: PeopleRoutesProps["profileProps"]["profileCustomPictureUrl"];
  profileEditLnAddress: PeopleRoutesProps["profileProps"]["profileEditLnAddress"];
  profileEditName: PeopleRoutesProps["profileProps"]["profileEditName"];
  profileEditPicture: PeopleRoutesProps["profileProps"]["profileEditPicture"];
  profileEditStatus: PeopleRoutesProps["profileProps"]["profileEditStatus"];
  profileEditsSavable: PeopleRoutesProps["profileProps"]["profileEditsSavable"];
  unregisteredOwnLightningAddress: PeopleRoutesProps["profileProps"]["unregisteredOwnLightningAddress"];
  profileStatus: PeopleRoutesProps["profileProps"]["profileStatus"];
  profileStatusCurrencies: PeopleRoutesProps["profileProps"]["profileStatusCurrencies"];
  profileStatusIsSaving: PeopleRoutesProps["profileProps"]["profileStatusIsSaving"];
  profilePhotoInputRef: PeopleRoutesProps["profileProps"]["profilePhotoInputRef"];
  profileSelectedPictureKind: PeopleRoutesProps["profileProps"]["profileSelectedPictureKind"];
  restoreArchivedContact: PeopleRoutesProps["contactEditProps"]["restoreArchivedContact"];
  restoreSelectedContact: PeopleRoutesProps["contactProps"]["restoreArchivedContact"];
  requestDeleteCurrentContact: PeopleRoutesProps["contactEditProps"]["requestDeleteCurrentContact"];
  requestSelectedContact: PeopleRoutesProps["contactPayProps"]["requestSelectedContact"];
  resetEditedContactFieldFromNostr: PeopleRoutesProps["contactEditProps"]["resetEditedContactFieldFromNostr"];
  saveClaimedLightningAddress: PeopleRoutesProps["profileProps"]["saveClaimedLightningAddress"];
  saveProfileEdits: PeopleRoutesProps["profileProps"]["saveProfileEdits"];
  searchNewContact: PeopleRoutesProps["contactNewProps"]["searchNewContact"];
  replyContext: PeopleRoutesProps["chatProps"]["replyContext"];
  selectedProfileStatusCurrencies: PeopleRoutesProps["profileProps"]["selectedProfileStatusCurrencies"];
  selectedContact: PeopleRoutesProps["contactProps"]["selectedContact"];
  selectedContactPublicProfile: {
    lnAddress: string;
    name: string;
  };
  sendChatImage: PeopleRoutesProps["chatProps"]["sendChatImage"];
  sendChatMessage: PeopleRoutesProps["chatProps"]["sendChatMessage"];
  setChatDraft: PeopleRoutesProps["chatProps"]["setChatDraft"];
  setContactPayMethod: PeopleRoutesProps["contactPayProps"]["setContactPayMethod"];
  setForm: PeopleRoutesProps["contactEditProps"]["setForm"];
  setMintIconUrlByMint: PeopleRoutesProps["chatProps"]["setMintIconUrlByMint"];
  setPayAmount: PeopleRoutesProps["contactPayProps"]["setPayAmount"];
  setProfileEditLnAddress: PeopleRoutesProps["profileProps"]["setProfileEditLnAddress"];
  setProfileEditName: PeopleRoutesProps["profileProps"]["setProfileEditName"];
  setProfileEditStatus: PeopleRoutesProps["profileProps"]["setProfileEditStatus"];
  t: Translate;
  toggleProfileStatusCurrency: PeopleRoutesProps["profileProps"]["toggleProfileStatusCurrency"];
  writeCurrentNpubToNfc: PeopleRoutesProps["profileProps"]["writeCurrentNpubToNfc"];
}

export const buildPeopleRouteProps = ({
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuIsBusy,
  canWriteNfc,
  chatSelectedContact,
  chatDraft,
  chatMessageElByIdRef,
  chatMessages,
  bankPaymentOfferMessages,
  chatMessagesRef,
  chatOwnPubkeyHex,
  chatSendIsBusy,
  contactEditsSavable,
  contactPaymentIntent,
  contactPayMethod,
  addNewContactFromSearchResult,
  contactSuggestions,
  contacts,
  copyText,
  currentNpub,
  cycleProfileAvatarControl,
  derivedProfile,
  displayUnit,
  editingId,
  editContext,
  effectiveMyLightningAddress,
  effectiveProfileName,
  effectiveProfilePicture,
  feedbackContactNpub,
  form,
  getCashuTokenMessageInfo,
  getMintIconUrl,
  getNpubMessageContactInfo,
  groupNames,
  handleSaveContact,
  isProfileEditing,
  isSavingContact,
  blockArchivedContact,
  lang,
  mentionContacts,
  makeNip98AuthHeader,
  myProfileQr,
  nostrPictureByNpub,
  onBlockUnknownContact,
  onCancelEdit,
  onCancelReply,
  onAddUnknownContact,
  onAddNpubContacts,
  contactsGroupAssignment,
  onCopy,
  onDeclinePaymentRequest,
  onRespondBankPaymentOffer,
  onSettleBankPaymentOffer,
  onEdit,
  onOpenNpubContact,
  onPayPaymentRequest,
  onPickProfilePhoto,
  onProfilePhotoError,
  onProfilePhotoSelected,
  onReact,
  onReply,
  openContactPay,
  ownedLightningAddresses,
  payAmount,
  payLightningInvoiceWithCashu,
  paySelectedContact,
  payWithCashuEnabled,
  reactionsByMessageId,
  route,
  selectedContactStatusText,
  pendingDeleteId,
  profileCustomPictureUrl,
  profileEditLnAddress,
  profileEditName,
  profileEditPicture,
  profileEditStatus,
  profileEditsSavable,
  unregisteredOwnLightningAddress,
  profileStatus,
  profileStatusCurrencies,
  profileStatusIsSaving,
  profilePhotoInputRef,
  profileSelectedPictureKind,
  restoreArchivedContact,
  restoreSelectedContact,
  requestDeleteCurrentContact,
  requestSelectedContact,
  resetEditedContactFieldFromNostr,
  saveClaimedLightningAddress,
  saveProfileEdits,
  searchNewContact,
  replyContext,
  selectedProfileStatusCurrencies,
  selectedContact,
  selectedContactPublicProfile,
  sendChatImage,
  sendChatMessage,
  setChatDraft,
  setContactPayMethod,
  setForm,
  setMintIconUrlByMint,
  setPayAmount,
  setProfileEditLnAddress,
  setProfileEditName,
  setProfileEditStatus,
  t,
  toggleProfileStatusCurrency,
  writeCurrentNpubToNfc,
}: BuildPeopleRoutePropsParams): PeopleRoutesProps => {
  return {
    bankPaymentOfferDetailProps: () => {
      if (route.kind !== "bankPaymentOffer") {
        throw new Error("invalid route for bank payment offer");
      }

      return {
        bankPaymentOfferMessages,
        chatId: route.chatId,
        chatMessages,
        chatOwnPubkeyHex,
        contacts,
        offerId: route.offerId,
        onCopyText: copyText,
        onRespondBankPaymentOffer,
        onSendChatImage: sendChatImage,
        onSettleBankPaymentOffer,
      };
    },
    chatProps: {
      selectedContact: chatSelectedContact,
      chatMessages,
      bankPaymentOfferMessages,
      chatMessagesRef,
      chatOwnPubkeyHex,
      chatDraft,
      setChatDraft,
      chatSendIsBusy,
      editContext,
      replyContext,
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      payWithCashuEnabled,
      feedbackContactNpub,
      lang,
      mentionContacts,
      reactionsByMessageId,
      setMintIconUrlByMint,
      chatMessageElByIdRef,
      getCashuTokenMessageInfo,
      getMintIconUrl,
      getNpubMessageContactInfo,
      onReply,
      onEdit,
      onReact,
      onCopy,
      onCancelReply,
      onCancelEdit,
      onAddUnknownContact,
      onAddNpubContacts,
      contactsGroupAssignment,
      onBlockUnknownContact,
      sendChatImage,
      sendChatMessage,
      openContactPay,
      onOpenNpubContact,
      onPayPaymentRequest,
      onDeclinePaymentRequest,
      onSettleBankPaymentOffer,
    },
    contactEditProps: {
      selectedContact,
      form,
      setForm,
      groupNames,
      editingId,
      contactEditsSavable,
      publicLnAddress: selectedContactPublicProfile.lnAddress,
      publicName: selectedContactPublicProfile.name,
      pendingDeleteId,
      handleSaveContact,
      isSavingContact,
      blockArchivedContact,
      restoreArchivedContact,
      requestDeleteCurrentContact,
      resetEditedContactFieldFromNostr,
      t,
    },
    contactNewProps: {
      addNewContactFromSearchResult,
      contactSuggestions,
      form,
      setForm,
      groupNames,
      handleSaveContact,
      isSavingContact,
      searchNewContact,
      t,
    },
    contactPayProps: {
      selectedContact,
      nostrPictureByNpub,
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      payWithCashuEnabled,
      contactPaymentIntent,
      contactPayMethod,
      setContactPayMethod,
      payAmount,
      setPayAmount,
      displayUnit,
      paySelectedContact,
      requestSelectedContact,
    },
    contactProps: {
      selectedContact,
      nostrPictureByNpub,
      cashuBalance,
      cashuIsBusy,
      copyText,
      payWithCashuEnabled,
      feedbackContactNpub,
      openContactPay,
      restoreArchivedContact: restoreSelectedContact,
      statusText: selectedContactStatusText,
      t,
    },
    profileProps: {
      cashuBalance,
      cashuBalanceAfterMelt,
      cashuIsBusy,
      canWriteToNfc: canWriteNfc,
      currentNpub,
      cycleProfileAvatarControl,
      isProfileEditing,
      profileCustomPictureUrl,
      profileEditPicture,
      effectiveProfilePicture,
      effectiveProfileName,
      profileEditName,
      profileEditLnAddress,
      profileEditStatus,
      derivedProfile,
      profileEditsSavable,
      unregisteredOwnLightningAddress,
      profileStatus,
      profileStatusCurrencies,
      profileStatusIsSaving,
      myProfileQr,
      effectiveMyLightningAddress,
      makeNip98AuthHeader,
      profilePhotoInputRef,
      profileSelectedPictureKind,
      payLightningInvoiceWithCashu,
      saveClaimedLightningAddress,
      selectedProfileStatusCurrencies,
      serverBaseUrl: NPUB_CASH_SERVER_BASE_URL,
      setProfileEditName,
      setProfileEditLnAddress,
      setProfileEditStatus,
      onProfilePhotoSelected,
      onProfilePhotoError,
      onPickProfilePhoto,
      ownedLightningAddresses,
      saveProfileEdits,
      copyText,
      toggleProfileStatusCurrency,
      writeCurrentNpubToNfc,
    },
  };
};
