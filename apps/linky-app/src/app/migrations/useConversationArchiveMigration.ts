// Migration bridge; removal gate in app/migrations/AGENTS.md
import type {
  ContactRow,
  ContactsRepository,
  ConversationRow,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { runWrite } from "../lib/storeWrite";
import {
  archivesToCopy,
  type ArchiveCopy,
} from "./conversationArchiveMigration";

const copyKey = (copy: ArchiveCopy): string =>
  `${copy.contactId}:${copy.archivedAtSec}`;

const reportCopied = (copies: ReadonlyArray<ArchiveCopy>): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.migration",
      tag: "ArchiveCopiedToContact",
      summary: `Copied ${copies.length} conversation archives onto their contacts`,
      links: {
        contact: copies.map((copy) => copy.contactId),
        conversation: copies.map((copy) => copy.conversationId),
      },
      payload: { copies },
    },
  ]);
};

/** Copies conversation archives onto their contacts once the account is hydrated; see `conversationArchiveMigration.ts`. */
export const useConversationArchiveMigration = ({
  contactRows,
  contactsRepository,
  conversationRows,
  hydrated,
}: {
  readonly contactRows: ReadonlyArray<ContactRow>;
  readonly contactsRepository: Pick<ContactsRepository, "archive">;
  readonly conversationRows: ReadonlyArray<ConversationRow>;
  readonly hydrated: boolean;
}): void => {
  // Rows read back after the write can lag behind it; this keeps the copy from repeating.
  const copiedRef = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!hydrated) return;
    const copies = archivesToCopy(contactRows, conversationRows).filter(
      (copy) => !copiedRef.current.has(copyKey(copy)),
    );
    if (copies.length === 0) return;
    for (const copy of copies) copiedRef.current.add(copyKey(copy));
    void runWrite(
      Effect.forEach(
        copies,
        (copy) =>
          contactsRepository.archive(copy.contactId, copy.archivedAtSec),
        { discard: true },
      ),
    ).then((outcome) => {
      if (outcome.ok) {
        reportCopied(copies);
        return;
      }
      for (const copy of copies) copiedRef.current.delete(copyKey(copy));
    });
  }, [contactRows, contactsRepository, conversationRows, hydrated]);
};
