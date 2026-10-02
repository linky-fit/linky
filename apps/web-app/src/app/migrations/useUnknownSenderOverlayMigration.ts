// Migration bridge; removal gate in app/migrations/AGENTS.md
import type { UnknownSendersRepository } from "@linky-fit/linksync";
import { Effect, Schema } from "effect";
import React from "react";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { UnknownRecord } from "../../utils/schema";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageRemove,
} from "../../utils/storage";
import { isBlockedPubkey } from "../lib/blockList";
import { runWrite } from "../lib/storeWrite";
import {
  overlayRowsToImport,
  unknownSenderOverlayKey,
} from "./unknownSenderOverlayMigration";

const reportImported = (
  rows: ReturnType<typeof overlayRowsToImport>,
  imported: number,
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.migration",
      tag: "UnknownSenderOverlayImported",
      summary: `Imported ${imported} of ${rows.length} unknown-sender messages from this device's overlay`,
      links: {
        message: rows.map((row) => row.id),
        pubkey: [...new Set(rows.map((row) => row.peerPubkey))],
      },
      payload: { overlay: rows.length, imported },
    },
  ]);
};

/** Imports this device's unknown-sender overlay once the account is hydrated; see `unknownSenderOverlayMigration.ts`. */
export const useUnknownSenderOverlayMigration = ({
  appOwnerId,
  hydrated,
  unknownSenders,
}: {
  readonly appOwnerId: string | null;
  readonly hydrated: boolean;
  readonly unknownSenders: Pick<UnknownSendersRepository, "insertIfAbsent">;
}): void => {
  const startedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!hydrated || !appOwnerId || startedRef.current === appOwnerId) return;
    const key = unknownSenderOverlayKey(appOwnerId);
    if (safeLocalStorageGet(key) === null) return;
    startedRef.current = appOwnerId;
    const rows = overlayRowsToImport(
      safeLocalStorageGetJson(key, Schema.Array(UnknownRecord), []),
      isBlockedPubkey,
    );
    let imported = 0;
    void runWrite(
      Effect.forEach(
        rows,
        (row) =>
          Effect.map(unknownSenders.insertIfAbsent(row), (wrote) => {
            if (wrote) imported += 1;
          }),
        { discard: true },
      ),
    ).then((outcome) => {
      if (!outcome.ok) {
        startedRef.current = null;
        return;
      }
      safeLocalStorageRemove(key);
      reportImported(rows, imported);
    });
  }, [appOwnerId, hydrated, unknownSenders]);
};
