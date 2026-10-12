import { NonEmptyString1000 } from "@linky-fit/linksync";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { getContactGroups } from "../../../utils/contactGroups";
import { getContactName } from "../../../utils/contactName";
import { keepUnchangedRows } from "../../../utils/structuralSharing";
import {
  joinContactChatState,
  type ContactWithChatState,
} from "../../lib/contactChatState";
import { liveAtom } from "../session/live";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
} from "../session/store";

const NO_ROWS: ReadonlyArray<never> = [];

/**
 * A live read's rows, empty until the first read answers. A re-read keeps
 * the previous rows meanwhile, and dependents only hear of new rows.
 */
export const liveRowsAtom = <A>(
  live: Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>>,
) =>
  Atom.keepAlive(
    Atom.readable((get) =>
      Option.getOrElse(AsyncResult.value(get(live)), () => NO_ROWS),
    ),
  );

export const contactRowsAtom = liveRowsAtom(
  liveAtom(contactsRepositoryAtom, (contacts) => contacts),
);

export const conversationRowsAtom = liveRowsAtom(
  liveAtom(conversationsRepositoryAtom, (conversations) => conversations),
);

const withNormalizedName = (
  row: ContactWithChatState,
): ContactWithChatState => {
  const name = getContactName(row);
  if (name === (row.name ?? "")) return row;
  const parsed = NonEmptyString1000.fromUnknown(name);
  return { ...row, name: parsed.ok ? parsed.value : null };
};

/** The saved contacts with their conversation's read cursors, newest first. */
export const contactsAtom = Atom.keepAlive(
  Atom.readable((get) =>
    keepUnchangedRows(
      Option.getOrUndefined(get.self<ContactWithChatState[]>()),
      joinContactChatState(get(contactRowsAtom), get(conversationRowsAtom))
        .map(withNormalizedName)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ),
  ),
);

export interface ContactGroups {
  /** Unarchived contacts per group. */
  readonly groupCounts: ReadonlyMap<string, number>;
  /** The groups, largest first. */
  readonly groupNames: string[];
  readonly ungroupedCount: number;
}

export const contactGroupsAtom = Atom.keepAlive(
  Atom.readable((get): ContactGroups => {
    const counts = new Map<string, number>();
    let ungrouped = 0;

    for (const contact of get(contactsAtom)) {
      const archivedAtSec = contact.archivedAtSec ?? 0;
      if (Number.isFinite(archivedAtSec) && archivedAtSec > 0) continue;

      const groups = getContactGroups(contact);
      if (groups.length === 0) {
        ungrouped += 1;
        continue;
      }
      for (const group of groups) {
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    }

    const names = Array.from(counts.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([name]) => name);

    return {
      groupCounts: counts,
      groupNames: names,
      ungroupedCount: ungrouped,
    };
  }),
);
