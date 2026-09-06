import { Archive, RefreshCcw, Save } from "lucide-react";
import type { FC } from "react";
import type { ContactId } from "../evolu";
import { ContactFields, type ContactFormData } from "./ContactNewPage";
import type { Translate } from "../i18n";

interface Contact {
  archivedAtSec?: number | string | null;
  id: ContactId;
  npub?: string | null;
}

interface ContactEditPageProps {
  contactEditsSavable: boolean;
  editingId: ContactId | null;
  form: ContactFormData;
  groupNames: string[];
  handleSaveContact: () => void;
  isSavingContact: boolean;
  blockArchivedContact: () => Promise<void>;
  publicLnAddress: string;
  publicName: string;
  pendingDeleteId: ContactId | null;
  restoreArchivedContact: () => void;
  requestDeleteCurrentContact: () => void;
  resetEditedContactFieldFromNostr: (field: "name" | "lnAddress") => void;
  selectedContact: Contact | null;
  setForm: (value: ContactFormData) => void;
  t: Translate;
}

export const ContactEditPage: FC<ContactEditPageProps> = ({
  contactEditsSavable,
  editingId,
  form,
  groupNames,
  handleSaveContact,
  isSavingContact,
  blockArchivedContact,
  publicLnAddress,
  publicName,
  pendingDeleteId,
  restoreArchivedContact,
  requestDeleteCurrentContact,
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

  return (
    <section className="panel panel-plain">
      {!selectedContact && <p className="muted">{t("contactNotFound")}</p>}

      <div className="form-grid">
        <div className="form-col">
          <ContactFields
            form={form}
            groupNames={groupNames}
            includeNpub
            lightningPublicValue={showPublicLnAddress ? publicLnAddress : ""}
            nameLabelAction={
              form.npub.trim() && form.name.trim() ? (
                <button
                  type="button"
                  className="icon-only-ghost"
                  onClick={() => void resetEditedContactFieldFromNostr("name")}
                  title={t("restore")}
                  aria-label={t("restore")}
                >
                  <RefreshCcw size={18} aria-hidden="true" />
                </button>
              ) : null
            }
            namePlaceholder={publicName || t("namePlaceholder")}
            namePublicValue={showPublicName ? publicName : ""}
            lightningLabelAction={
              form.npub.trim() && form.lnAddress.trim() ? (
                <button
                  type="button"
                  className="icon-only-ghost"
                  onClick={() =>
                    void resetEditedContactFieldFromNostr("lnAddress")
                  }
                  title={t("restore")}
                  aria-label={t("restore")}
                >
                  <RefreshCcw size={18} aria-hidden="true" />
                </button>
              ) : null
            }
            lightningPlaceholder={
              publicLnAddress || t("lightningAddressPlaceholder")
            }
            setForm={setForm}
            t={t}
          />

          <div className="actions">
            {editingId ? (
              contactEditsSavable && (
                <button onClick={handleSaveContact} disabled={isSavingContact}>
                  <span className="btn-label-with-icon">
                    <span className="btn-label-icon" aria-hidden="true">
                      <Save size={18} />
                    </span>
                    <span>
                      {isSavingContact ? t("saving") : t("saveChanges")}
                    </span>
                  </span>
                </button>
              )
            ) : (
              <button
                onClick={handleSaveContact}
                data-guide="contact-save"
                disabled={isSavingContact}
              >
                {isSavingContact ? t("saving") : t("saveContact")}
              </button>
            )}
            {isArchivedContact ? (
              <>
                <button
                  type="button"
                  className="ghost"
                  onClick={restoreArchivedContact}
                  disabled={!editingId}
                  title={t("restoreArchivedContact")}
                >
                  {t("restoreArchivedContact")}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void blockArchivedContact();
                  }}
                  disabled={!editingId || !canBlockArchivedContact}
                  title={t("blockContact")}
                >
                  {t("blockContact")}
                </button>
              </>
            ) : (
              <button
                className={pendingDeleteId === editingId ? "danger" : "ghost"}
                onClick={requestDeleteCurrentContact}
                disabled={!editingId}
                title={
                  pendingDeleteId === editingId
                    ? t("archiveArmedHint")
                    : t("archiveContact")
                }
              >
                <span className="btn-label-with-icon">
                  <span className="btn-label-icon" aria-hidden="true">
                    <Archive size={18} />
                  </span>
                  <span>{t("archiveContact")}</span>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
