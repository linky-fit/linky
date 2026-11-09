// Migration bridge; removal gate in app/migrations/AGENTS.md
import {
  hiddenListingIdFor,
  NonEmptyString100,
  NonEmptyString1000,
  type ContactRow,
  type ContactsRepository,
  type HiddenListingsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React from "react";
import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";
import { runWrite } from "../lib/storeWrite";
import {
  forgetLocalHiddenListings,
  hiddenListingsToMove,
  readLocalHiddenListings,
  type HiddenListingsMigration,
} from "./hiddenListingsMigration";

const reportMoved = ({ moves, contactsToClear }: HiddenListingsMigration) => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.migration",
      tag: "HiddenListingsMovedToTable",
      summary: `Moved ${moves.length} hidden listings into their own table`,
      links: { contact: [...contactsToClear] },
      payload: { moves },
    },
  ]);
};

/** Moves the listings hidden on this device or on contact rows into `hiddenListing` once the account is hydrated; see `hiddenListingsMigration.ts`. */
export const useHiddenListingsMigration = ({
  contactRows,
  contactsRepository,
  hiddenListingsRepository,
  hydrated,
}: {
  readonly contactRows: ReadonlyArray<ContactRow>;
  readonly contactsRepository: Pick<ContactsRepository, "update">;
  readonly hiddenListingsRepository: Pick<
    HiddenListingsRepository,
    "insertIfAbsent"
  >;
  readonly hydrated: boolean;
}): void => {
  const runningRef = React.useRef(false);
  React.useEffect(() => {
    if (!hydrated || runningRef.current) return;
    const migration = hiddenListingsToMove(
      readLocalHiddenListings(),
      contactRows,
    );
    if (migration.moves.length === 0 && migration.contactsToClear.length === 0)
      return;
    runningRef.current = true;
    void runWrite(
      Effect.gen(function* () {
        // A row another device already removed stays removed, so a listing shown again is not hidden back.
        for (const { author, listingId } of migration.moves)
          yield* hiddenListingsRepository.insertIfAbsent({
            id: hiddenListingIdFor(author, listingId),
            authorPubkey: NonEmptyString100.orThrow(author),
            listingId: NonEmptyString1000.orThrow(listingId),
          });
        for (const id of migration.contactsToClear)
          yield* contactsRepository.update(id, { hiddenListingIdsJson: null });
      }),
    ).then((outcome) => {
      runningRef.current = false;
      if (!outcome.ok) return;
      forgetLocalHiddenListings();
      reportMoved(migration);
    });
  }, [contactRows, contactsRepository, hiddenListingsRepository, hydrated]);
};
