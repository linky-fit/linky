import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { Translate } from "../../../i18n";
import { PENDING_ONBOARDER_NPUB_STORAGE_KEY } from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
} from "../../../utils/storage";
import type { ContactIdentityRowLike } from "../../types/appTypes";
import type { useSaveNpubContact } from "./useSaveNpubContact";

interface UsePendingOnboarderParams {
  currentNpub: string | null;
  /** The contacts owner lane is known; the outbox holds the greeting until a relay accepts it. */
  ready: boolean;
  saveNpubContact: ReturnType<typeof useSaveNpubContact>;
  sendChatMessageTo: (args: {
    contact: ContactIdentityRowLike;
    text: string;
  }) => Promise<void>;
  t: Translate;
}

/**
 * Replays the onboarder npub parked from an onboarding link at boot: saves
 * them as a contact and greets them so they know the newcomer arrived.
 */
export const usePendingOnboarder = ({
  currentNpub,
  ready,
  saveNpubContact,
  sendChatMessageTo,
  t,
}: UsePendingOnboarderParams): void => {
  const [pendingNpub, setPendingNpub] = React.useState<string | null>(() =>
    normalizeNpubIdentifier(
      safeLocalStorageGet(PENDING_ONBOARDER_NPUB_STORAGE_KEY) ?? "",
    ),
  );

  React.useEffect(() => {
    if (!pendingNpub || !ready) return;

    setPendingNpub(null);
    safeLocalStorageRemove(PENDING_ONBOARDER_NPUB_STORAGE_KEY);
    if (pendingNpub === normalizeNpubIdentifier(currentNpub ?? "")) return;

    const saved = saveNpubContact(pendingNpub);
    if (!saved) return;
    reportAppLog({
      tag: "onboarding.joined",
      summary: saved.created
        ? "Saved the onboarder as a contact and greeted them"
        : "Greeted the already saved onboarder",
      links: { contact: saved.contact.id },
      payload: { npub: pendingNpub, created: saved.created },
    });
    void sendChatMessageTo({
      contact: saved.contact,
      text: t("onboardJoinedMessage"),
    });
  }, [currentNpub, pendingNpub, ready, saveNpubContact, sendChatMessageTo, t]);
};
