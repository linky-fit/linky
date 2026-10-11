import { Button, EmptyState, IconButton, Row } from "@linky-fit/ui";
import { useAtomValue } from "@linky-fit/linkstr-react";
import type { FC } from "react";
import {
  useArchiveContact,
  useBlockEditedContact,
  useRestoreArchivedContact,
} from "../app/hooks/contacts/useContactActions";
import {
  useContactEditor,
  useContactEditorParams,
} from "../app/hooks/contacts/useContactEditor";
import { useRoutePeopleContact } from "../app/hooks/contacts/useDisplayContacts";
import { useTranslation } from "../app/hooks/shell";
import { contactGroupsAtom } from "../app/state/contacts/readModel";
import type { Route } from "../types/route";
import { BlockContactButton } from "../components/BlockContactButton";
import type { ContactId } from "../evolu";
import { ContactFields, type ContactFormData } from "./ContactNewPage";
import type { Translate } from "../i18n";
import { PageCard } from "../components/PageCard";

interface Contact {
  archivedAtSec?: number | string | null;
  id: ContactId;
  npub?: string | null;
}

interface ContactEditPageProps {
  archiveCurrentContact: () => void;
  contactEditsSavable: boolean;
  editingId: ContactId | null;
  form: ContactFormData;
  groupNames: string[];
  handleSaveContact: () => void;
  isSavingContact: boolean;
  blockArchivedContact: () => Promise<void>;
  publicLnAddress: string;
  publicName: string;
  restoreArchivedContact: () => void;
  resetEditedContactFieldFromNostr: (field: "name" | "lnAddress") => void;
  selectedContact: Contact | null;
  setForm: (value: ContactFormData) => void;
  t: Translate;
}

export const ContactEditPage: FC<ContactEditPageProps> = ({
  archiveCurrentContact,
  contactEditsSavable,
  editingId,
  form,
  groupNames,
  handleSaveContact,
  isSavingContact,
  blockArchivedContact,
  publicLnAddress,
  publicName,
  restoreArchivedContact,
  resetEditedContactFieldFromNostr,
  selectedContact,
  setForm,
  t,
}) => {
  const isArchivedContact = Number(selectedContact?.archivedAtSec ?? 0) > 0;
  const canBlockArchivedContact = Boolean((selectedContact?.npub ?? "").trim());
  const showPublicName = Boolean(
    publicName && form.name.trim() && form.name.trim() !== publicName,
  );
  const showPublicLnAddress = Boolean(
    publicLnAddress &&
    form.lnAddress.trim() &&
    form.lnAddress.trim().toLowerCase() !== publicLnAddress.toLowerCase(),
  );

  const restoreButton = (field: "name" | "lnAddress") => (
    <IconButton
      icon="RefreshCcw"
      size="sm"
      accessibilityLabel={t("restore")}
      onPress={() => void resetEditedContactFieldFromNostr(field)}
    />
  );

  return (
    <PageCard gap="$lg">
      {!selectedContact && <EmptyState title={t("contactNotFound")} />}

      <ContactFields
        form={form}
        groupNames={groupNames}
        includeNpub
        lightningPublicValue={showPublicLnAddress ? publicLnAddress : ""}
        nameAction={
          form.npub.trim() && form.name.trim() ? restoreButton("name") : null
        }
        namePlaceholder={publicName || t("namePlaceholder")}
        namePublicValue={showPublicName ? publicName : ""}
        lightningAction={
          form.npub.trim() && form.lnAddress.trim()
            ? restoreButton("lnAddress")
            : null
        }
        lightningPlaceholder={
          publicLnAddress || t("lightningAddressPlaceholder")
        }
        setForm={setForm}
        t={t}
      />

      <Row gap="$sm" flexWrap="wrap">
        {editingId ? (
          contactEditsSavable && (
            <Button
              icon="Save"
              onPress={handleSaveContact}
              loading={isSavingContact}
            >
              {t("saveChanges")}
            </Button>
          )
        ) : (
          <Button
            onPress={handleSaveContact}
            data-guide="contact-save"
            loading={isSavingContact}
          >
            {t("saveContact")}
          </Button>
        )}
        {isArchivedContact ? (
          <>
            <Button
              variant="secondary"
              icon="ArchiveRestore"
              onPress={restoreArchivedContact}
              disabled={!editingId}
            >
              {t("restoreArchivedContact")}
            </Button>
            <BlockContactButton
              onConfirm={blockArchivedContact}
              disabled={!editingId || !canBlockArchivedContact}
              t={t}
            />
          </>
        ) : (
          <Button
            variant="secondary"
            icon="Archive"
            onPress={archiveCurrentContact}
            disabled={!editingId}
          >
            {t("archiveContact")}
          </Button>
        )}
      </Row>
    </PageCard>
  );
};

export const ContactEditRoute: FC<{ route: Route }> = ({ route }) => {
  const { t } = useTranslation();
  const selectedContact = useRoutePeopleContact(route);
  const { groupNames } = useAtomValue(contactGroupsAtom);
  const editor = useContactEditor(useContactEditorParams(route));
  const archiveContact = useArchiveContact();
  const restoreArchivedContact = useRestoreArchivedContact();
  const blockArchivedContact = useBlockEditedContact(route, selectedContact);
  const { editingId } = editor;
  return (
    <ContactEditPage
      archiveCurrentContact={() => {
        if (editingId) void archiveContact(editingId);
      }}
      blockArchivedContact={blockArchivedContact}
      contactEditsSavable={editor.contactEditsSavable}
      editingId={editingId}
      form={editor.form}
      groupNames={groupNames}
      handleSaveContact={editor.handleSaveContact}
      isSavingContact={editor.isSavingContact}
      publicLnAddress={editor.selectedContactPublicProfile.lnAddress}
      publicName={editor.selectedContactPublicProfile.name}
      resetEditedContactFieldFromNostr={editor.resetEditedContactFieldFromNostr}
      restoreArchivedContact={() => {
        if (editingId) void restoreArchivedContact(editingId);
      }}
      selectedContact={selectedContact}
      setForm={editor.setForm}
      t={t}
    />
  );
};
