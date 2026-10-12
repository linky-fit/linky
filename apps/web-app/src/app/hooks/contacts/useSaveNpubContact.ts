import { useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  saveNpubContactAtom,
  type SavedNpubContact,
} from "../../state/contacts/commands";
import { currentNpubAtom } from "../../state/session/session";
import { useSetStatus, useTranslation } from "../shell";

/**
 * Saves a Nostr peer as a contact; a row that fails to store shows as the
 * status. The user's own npub is never saved: the caller gets null and a status.
 */
export const useSaveNpubContact = () => {
  const save = Option.getOrNull(
    AsyncResult.value(useAtomValue(saveNpubContactAtom)),
  );
  const currentNpub = useAtomValue(currentNpubAtom);
  const setStatus = useSetStatus();
  const { t } = useTranslation();
  return React.useCallback(
    (rawNpub: string): SavedNpubContact | null => {
      if (save === null) return null;
      const npub = normalizeNpubIdentifier(rawNpub);
      if (npub && npub === normalizeNpubIdentifier(currentNpub ?? "")) {
        setStatus(t("contactIsYou"));
        return null;
      }
      return save(rawNpub, (error) =>
        setStatus(`${t("errorPrefix")}: ${error}`),
      );
    },
    [currentNpub, save, setStatus, t],
  );
};
