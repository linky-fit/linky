// Migration bridge; removal gate in app/migrations/AGENTS.md
import type { ContactRow, ContactsRepository } from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { runWrite } from "../lib/storeWrite";
import {
  forgetLocalHiddenListings,
  hiddenListingsToMove,
  readLocalHiddenListings,
  type HiddenListingMove,
} from "./hiddenListingsMigration";

const reportMoved = (moves: ReadonlyArray<HiddenListingMove>): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.migration",
      tag: "HiddenListingsMovedToContacts",
      summary: `Moved ${moves.length} hidden listings from this device onto their contacts`,
      links: { contact: moves.map((move) => move.contactId) },
      payload: { moves },
    },
  ]);
};

/** Moves the listings hidden in this device's storage onto their contacts once the account is hydrated; see `hiddenListingsMigration.ts`. */
export const useHiddenListingsMigration = ({
  contactRows,
  contactsRepository,
  hydrated,
}: {
  readonly contactRows: ReadonlyArray<ContactRow>;
  readonly contactsRepository: Pick<ContactsRepository, "setListingHidden">;
  readonly hydrated: boolean;
}): void => {
  const runningRef = React.useRef(false);
  React.useEffect(() => {
    if (!hydrated || runningRef.current) return;
    const keys = readLocalHiddenListings();
    if (keys.length === 0) return;
    runningRef.current = true;
    const moves = hiddenListingsToMove(keys, contactRows);
    void runWrite(
      Effect.forEach(
        moves,
        (move) =>
          contactsRepository.setListingHidden(
            move.contactId,
            move.listingId,
            true,
          ),
        { discard: true },
      ),
    ).then((outcome) => {
      runningRef.current = false;
      if (!outcome.ok) return;
      forgetLocalHiddenListings();
      reportMoved(moves);
    });
  }, [contactRows, contactsRepository, hydrated]);
};
