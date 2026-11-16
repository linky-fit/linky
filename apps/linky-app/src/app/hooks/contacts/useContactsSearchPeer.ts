import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { normalizeContactSearchQuery } from "../../../utils/profileShareUrl";
import { currentNpubAtom } from "../../state/session/session";
import {
  isExactContactQuery,
  useContactCandidates,
  type ContactSearchCandidate,
} from "./useContactCandidates";
import { useContacts } from "./useDisplayContacts";

/** Typing pauses this long before a query leaves the device. */
const LOOKUP_DELAY_MS = 600;

export interface ContactsSearchPeer {
  candidate: ContactSearchCandidate | null;
  searching: boolean;
}

/** Whether a contacts search names exactly one profile, see `useContactsSearchPeer`. */
export const isContactsSearchExact = (search: string): boolean =>
  isExactContactQuery(normalizeContactSearchQuery(search));

/**
 * The profile a contacts search names exactly: an npub, a profile link or a
 * NIP-05, a bare name meaning a Linky one.
 */
export const useContactsSearchPeer = (search: string): ContactsSearchPeer => {
  const contacts = useContacts();
  const currentNpub = useAtomValue(currentNpubAtom);
  const { resolveExactContact } = useContactCandidates(contacts, currentNpub);
  // Contacts change under a running lookup; only a new query starts another.
  const resolveRef = React.useRef(resolveExactContact);
  React.useEffect(() => {
    resolveRef.current = resolveExactContact;
  }, [resolveExactContact]);
  const query = normalizeContactSearchQuery(search);
  const active = isExactContactQuery(query);
  const [found, setFound] = React.useState<{
    candidate: ContactSearchCandidate | null;
    query: string;
    settled: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setFound({ candidate: null, query, settled: false });
      void resolveRef
        .current(query, (candidate) => {
          if (!cancelled) setFound({ candidate, query, settled: false });
        })
        .then((result) => {
          if (cancelled) return;
          setFound({
            candidate: result.kind === "resolved" ? result.contact : null,
            query,
            settled: true,
          });
        });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query]);

  if (!active) return { candidate: null, searching: false };
  if (found?.query !== query) return { candidate: null, searching: true };
  return { candidate: found.candidate, searching: !found.settled };
};
