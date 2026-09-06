import { writeContact } from "../lib/writeContact";
import * as Evolu from "@evolu/common";
import React from "react";
import type { OwnerId } from "@evolu/common";
import { navigateTo } from "../../hooks/useRouting";
import { FEEDBACK_CONTACT_NPUB } from "../../utils/constants";
import type { ContactNameRowLike } from "../types/appTypes";
import type { Translate } from "../../i18n";

type EvoluMutations = ReturnType<typeof import("../../evolu").useEvolu>;

interface UseFeedbackContactParams<
  TContact extends ContactNameRowLike & { npub?: string | null | undefined },
> {
  appOwnerId: OwnerId | null;
  contacts: readonly TContact[];
  insert: EvoluMutations["insert"];
  pushToast: (message: string) => void;
  t: Translate;
  update: EvoluMutations["update"];
}

export const useFeedbackContact = <
  TContact extends ContactNameRowLike & { npub?: string | null | undefined },
>({
  appOwnerId,
  contacts,
  insert,
  pushToast,
  t,
  update,
}: UseFeedbackContactParams<TContact>) => {
  const openFeedbackContactPendingRef = React.useRef(false);

  const openFeedbackContact = React.useCallback(() => {
    const targetNpub = FEEDBACK_CONTACT_NPUB;
    const existing = contacts.find(
      (contact) => (contact.npub ?? "").trim() === targetNpub,
    );

    if (existing?.id) {
      if ((existing.name ?? "") === "Feedback") {
        update("contact", { id: existing.id, name: null });
      }
      openFeedbackContactPendingRef.current = false;
      navigateTo({ route: "chat", id: existing.id });
      return;
    }

    openFeedbackContactPendingRef.current = true;

    const payload = {
      name: null,
      npub: Evolu.NonEmptyString1000.orThrow(targetNpub),
      lnAddress: null,
      groupName: null,
    };

    const result = writeContact(insert, payload, appOwnerId);

    if (result.ok) return;

    openFeedbackContactPendingRef.current = false;
    pushToast(`${t("errorPrefix")}: ${String(result.error)}`);
  }, [appOwnerId, contacts, insert, pushToast, t, update]);

  React.useEffect(() => {
    if (!openFeedbackContactPendingRef.current) return;

    const targetNpub = FEEDBACK_CONTACT_NPUB;
    const existing = contacts.find(
      (contact) => (contact.npub ?? "").trim() === targetNpub,
    );
    if (!existing?.id) return;

    openFeedbackContactPendingRef.current = false;
    navigateTo({ route: "chat", id: existing.id });
  }, [contacts]);

  return {
    openFeedbackContact,
  };
};
