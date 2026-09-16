import { Atom } from "@effect-atom/atom-react";
import type {
  InboxCursorStore,
  NostrSecretKey,
  NostrTransport,
  OutboxStore,
  RelayUrl,
} from "@linky/linkstr";
import type { Layer } from "effect";

export interface LinkstrConfig {
  readonly allowInsecureLocalhost?: boolean;
  readonly secretKey: NostrSecretKey;
  readonly readRelays: ReadonlyArray<RelayUrl>;
  readonly writeRelays: ReadonlyArray<RelayUrl>;
  /** Test/e2e seam: replaces the real websocket transport when provided. */
  readonly transport?: Layer.Layer<NostrTransport>;
  /**
   * Durable outbox job storage — platform code supplies it (web:
   * `OutboxStore.fromStringStorage(localStorage, ...)`). Defaults to
   * non-durable in-memory storage.
   */
  readonly outboxStore?: Layer.Layer<OutboxStore>;
  /**
   * Durable wrap-inbox cursor storage — platform code supplies it (web:
   * `InboxCursorStore.fromStringStorage(localStorage, ...)`). Defaults to
   * non-durable in-memory storage.
   */
  readonly inboxCursorStore?: Layer.Layer<InboxCursorStore>;
  /** Streams diagnostics through `inspectorEventsAtom` when true. */
  readonly inspector?: boolean;
}

/** Null while logged out; every linkstr action then fails with LinkstrNotConfigured. */
export const linkstrConfigAtom = Atom.make<LinkstrConfig | null>(null);
