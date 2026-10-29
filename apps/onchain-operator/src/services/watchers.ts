import { createId } from "@linky-fit/domain";
import { ClientId, encodeNpub, MessageText } from "@linky-fit/linkstr";
import type { OperatorProfile } from "../domain/profile";
import { watcherAlertText, type WatcherAlert } from "../domain/watchers";
import type { Nostr } from "./nostr";

const WATCHER_REF = "watcher:";

/** Tells every watcher, in a Linky chat message, about something that waits for the operator; best effort. */
export type AlertWatchers = (alert: WatcherAlert) => Promise<void>;

export const createWatcherAlerts =
  ({
    nostr,
    loadProfile,
  }: {
    readonly nostr: Pick<Nostr, "sendText">;
    readonly loadProfile: () => Promise<OperatorProfile | null>;
  }): AlertWatchers =>
  async (alert) => {
    const user = alert._tag === "message" ? alert.from : alert.transfer.user;
    const watchers = (await loadProfile())?.watchers ?? [];
    // A watcher's own message, e.g. a reply to an alert, is no news to the others.
    if (watchers.includes(user)) return;
    const text = MessageText.make(watcherAlertText(alert, encodeNpub(user)));
    await Promise.all(
      watchers
        .filter((watcher) => watcher !== user)
        .map(async (watcher) => {
          const clientId = ClientId.make(createId());
          await nostr
            .sendText(watcher, text, clientId, `${WATCHER_REF}${clientId}`)
            .catch((error: unknown) => {
              console.warn("[onchain-operator] watcher not alerted", error);
            });
        }),
    );
  };
