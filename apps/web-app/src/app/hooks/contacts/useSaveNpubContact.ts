import { useAtomValue } from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import {
  saveNpubContactAtom,
  type SavedNpubContact,
} from "../../state/contacts/commands";
import { useSetStatus, useTranslation } from "../shell";

/** Saves a Nostr peer as a contact; a row that fails to store shows as the status. */
export const useSaveNpubContact = () => {
  const save = Option.getOrNull(
    AsyncResult.value(useAtomValue(saveNpubContactAtom)),
  );
  const setStatus = useSetStatus();
  const { t } = useTranslation();
  return React.useCallback(
    (rawNpub: string): SavedNpubContact | null =>
      save === null
        ? null
        : save(rawNpub, (error) => setStatus(`${t("errorPrefix")}: ${error}`)),
    [save, setStatus, t],
  );
};
