import { Schema } from "effect";
import {
  getEventHash,
  verifyEvent,
  type Event,
  type Filter,
} from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import type { TrackerSession } from "./auth";
import { parseReport, type ErrorReport } from "./reports";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.0xchat.com",
];

export interface RelayResult {
  url: string;
  scanned: number;
  complete: boolean;
  error: string | null;
}

export interface InboxProgress {
  scanned: number;
  errors: number;
  relay: string;
}

export interface InboxResult {
  reports: ErrorReport[];
  relays: RelayResult[];
  scanned: number;
  ignored: number;
}

const EventFields = {
  id: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  pubkey: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  created_at: Schema.NonNegativeInt,
  kind: Schema.NonNegativeInt,
  tags: Schema.mutable(
    Schema.Array(Schema.mutable(Schema.Array(Schema.String))),
  ),
  content: Schema.String,
};
const SignedEventJson = Schema.parseJson(
  Schema.Struct({ ...EventFields, sig: Schema.String }),
);
const RumorJson = Schema.parseJson(Schema.Struct(EventFields));

const isAddressedTo = (tags: string[][], pubkey: string) =>
  tags.some((tag) => tag[0] === "p" && tag[1] === pubkey);

export const normalizeRelays = (urls: readonly string[]): string[] => {
  const normalized = urls.flatMap((value) => {
    try {
      const url = new URL(value.trim());
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.username || url.password || url.hash) return [];
      if (url.protocol !== "wss:" && !(local && url.protocol === "ws:"))
        return [];
      return [url.toString().replace(/\/$/, "")];
    } catch {
      return [];
    }
  });
  return [...new Set(normalized)];
};

export const decryptReport = async (
  wrap: Event,
  session: TrackerSession,
  relay: string,
): Promise<ErrorReport | null> => {
  try {
    if (
      wrap.kind !== 1059 ||
      !isAddressedTo(wrap.tags, session.pubkey) ||
      !verifyEvent(wrap)
    )
      return null;
    const seal = Schema.decodeUnknownSync(SignedEventJson)(
      await session.decrypt(wrap.pubkey, wrap.content),
    );
    if (seal.kind !== 13 || !verifyEvent(seal)) return null;
    const rumor = Schema.decodeUnknownSync(RumorJson)(
      await session.decrypt(seal.pubkey, seal.content),
    );
    if (
      rumor.kind !== 24134 ||
      rumor.pubkey !== seal.pubkey ||
      rumor.id !== getEventHash(rumor) ||
      !isAddressedTo(rumor.tags, session.pubkey)
    )
      return null;
    return parseReport(rumor.content, {
      wrapId: wrap.id,
      rumorId: rumor.id,
      senderPubkey: rumor.pubkey,
      relay,
    });
  } catch {
    return null;
  }
};

interface Page {
  events: Event[];
  complete: boolean;
  error: string | null;
}

const queryPage = (
  relay: Relay,
  filter: Filter,
  signal: AbortSignal,
): Promise<Page> =>
  new Promise((resolve) => {
    const events: Event[] = [];
    if (signal.aborted) {
      resolve({ events, complete: false, error: "Loading cancelled." });
      return;
    }
    let settled = false;
    const finish = (complete: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      subscription.close();
      resolve({ events, complete, error });
    };
    const abort = () => finish(false, "Loading cancelled.");
    const timeout = setTimeout(
      () => finish(false, "Relay query timed out."),
      12_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    const subscription = relay.prepareSubscription([filter], {
      onevent: (event) => events.push(event),
      oneose: () => finish(true, null),
      onclose: () => finish(false, "Relay closed the query."),
      // nostr-tools also calls oneose on its own timeout; our timer owns failure.
      eoseTimeout: 60_000,
    });
    subscription.fire();
  });

const connectRelay = async (
  url: string,
  signal: AbortSignal,
): Promise<Relay> => {
  signal.throwIfAborted();
  const relay = new Relay(url, { enablePing: false, enableReconnect: false });
  relay.onnotice = () => undefined;
  const close = () => relay.close();
  signal.addEventListener("abort", close, { once: true });
  try {
    await relay.connect({ timeout: 8_000 });
    signal.throwIfAborted();
    return relay;
  } catch {
    relay.close();
    throw new Error("Could not connect to relay.");
  } finally {
    signal.removeEventListener("abort", close);
  }
};

const waitForReport = (
  report: Promise<ErrorReport | null>,
  signal: AbortSignal,
): Promise<ErrorReport | null> =>
  new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Loading cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    report
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });

const discoverRelays = async (
  urls: string[],
  session: TrackerSession,
  signal: AbortSignal,
): Promise<string[]> => {
  const lists = await Promise.all(
    urls.map(async (url) => {
      let relay: Relay | undefined;
      try {
        relay = await connectRelay(url, signal);
        const page = await queryPage(
          relay,
          {
            authors: [session.pubkey],
            kinds: [10050, 10002],
            limit: 10,
          },
          signal,
        );
        return page.events.filter(
          (event) => event.pubkey === session.pubkey && verifyEvent(event),
        );
      } catch {
        return [];
      } finally {
        relay?.close();
      }
    }),
  );
  const events = lists.flat().sort((a, b) => b.created_at - a.created_at);
  const inbox = events.find((event) => event.kind === 10050);
  const general = events.find((event) => event.kind === 10002);
  return normalizeRelays([
    ...urls,
    ...(inbox?.tags
      .filter((tag) => tag[0] === "relay")
      .flatMap((tag) => (tag[1] ? [tag[1]] : [])) ?? []),
    ...(general?.tags
      .filter((tag) => tag[0] === "r" && tag[2] !== "write")
      .flatMap((tag) => (tag[1] ? [tag[1]] : [])) ?? []),
  ]);
};

export const fetchReports = async (
  session: TrackerSession,
  options: {
    relays: readonly string[];
    signal: AbortSignal;
    onProgress: (progress: InboxProgress) => void;
  },
): Promise<InboxResult> => {
  const { signal, onProgress } = options;
  const urls = normalizeRelays(options.relays);
  if (!urls.length) throw new Error("Enter at least one valid relay URL.");
  const relayUrls = await discoverRelays(urls, session, signal);
  const reports = new Map<string, ErrorReport>();
  const seen = new Set<string>();
  let ignored = 0;
  const relays: RelayResult[] = [];
  for (const url of relayUrls) {
    const result: RelayResult = {
      url,
      scanned: 0,
      complete: false,
      error: null,
    };
    relays.push(result);
    if (signal.aborted) {
      result.error = "Loading cancelled.";
      continue;
    }
    let relay: Relay | undefined;
    try {
      onProgress({ scanned: seen.size, errors: reports.size, relay: url });
      relay = await connectRelay(url, signal);
      let until: number | undefined;
      let limit = 500;
      const relaySeen = new Set<string>();
      while (!signal.aborted) {
        const page = await queryPage(
          relay,
          {
            kinds: [1059],
            "#p": [session.pubkey],
            limit,
            ...(until === undefined ? {} : { until }),
          },
          signal,
        );
        for (const wrap of page.events) {
          if (!relaySeen.has(wrap.id)) {
            relaySeen.add(wrap.id);
            result.scanned++;
          }
          if (seen.has(wrap.id)) continue;
          seen.add(wrap.id);
          if (signal.aborted) break;
          const report = await waitForReport(
            decryptReport(wrap, session, url),
            signal,
          );
          if (signal.aborted) break;
          if (report) {
            const previous = reports.get(report.id);
            if (!previous || previous.createdAtSec < report.createdAtSec) {
              reports.set(report.id, report);
            }
          } else ignored++;
          onProgress({ scanned: seen.size, errors: reports.size, relay: url });
        }
        if (!page.complete) {
          result.error = page.error;
          break;
        }
        if (page.events.length === 0) {
          result.complete = true;
          break;
        }
        const oldest = Math.min(
          ...page.events.map((event) => event.created_at),
        );
        if (oldest === until) {
          if (page.events.length < limit) {
            if (oldest === 0) {
              result.complete = true;
              break;
            }
            until = oldest - 1;
            limit = 500;
          } else if (limit >= 16_000) {
            result.error =
              "Too many events at one timestamp; history may be incomplete.";
            break;
          } else {
            limit *= 2;
          }
        } else {
          until = oldest;
          limit = 500;
        }
      }
      if (signal.aborted) result.error = "Loading cancelled.";
    } catch {
      result.error = signal.aborted
        ? "Loading cancelled."
        : "Could not read relay.";
    } finally {
      relay?.close();
    }
  }
  return {
    reports: [...reports.values()].sort(
      (a, b) => b.createdAtSec - a.createdAtSec,
    ),
    relays,
    scanned: seen.size,
    ignored,
  };
};
