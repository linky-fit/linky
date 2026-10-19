import React from "react";
import {
  appendPendingDeepLink,
  readPendingDeepLinks,
  removePendingDeepLink,
} from "../lib/pendingDeepLinks";

/**
 * Handles inbound links (web fragments, native deep links) one at a time,
 * oldest first, once `ready`. Each link stays in storage until its handling
 * has finished, so a reload mid-queue picks up where it stopped. Returns the
 * function producers call to queue a link.
 */
export const usePendingDeepLink = ({
  handle,
  ready,
}: {
  handle: (text: string) => Promise<void>;
  ready: boolean;
}): ((text: string) => void) => {
  const [links, setLinks] = React.useState(readPendingDeepLinks);
  const handling = React.useRef(false);

  const enqueue = React.useCallback((text: string) => {
    const link = text.trim();
    if (link) setLinks(appendPendingDeepLink(link));
  }, []);

  React.useEffect(() => {
    const [link] = links;
    if (!ready || link === undefined || handling.current) return;
    handling.current = true;
    // A link whose handling throws counts as handled; it is not retried.
    void handle(link)
      .catch(() => {})
      .finally(() => {
        handling.current = false;
        setLinks(removePendingDeepLink(link));
      });
  }, [handle, links, ready]);

  return enqueue;
};
