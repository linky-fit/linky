import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { Event, Filter } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import { bytesToHex } from "nostr-tools/utils";
import { hasValidSignature } from "../signature.js";
import type { LinkauthRelayPool } from "../client/index.js";
import type { LinkauthTemplate } from "../types.js";
import { signLogin } from "./fixtures.js";

interface Subscription {
  filter: Filter;
  onevent: (event: Event) => void;
  onclose: (() => void) | undefined;
}

/** In-memory relay: forwards published events to open subscriptions that match, like an ephemeral-kind relay. */
export class FakeRelayPool implements LinkauthRelayPool {
  readonly published: Event[] = [];
  private readonly subscriptions = new Set<Subscription>();
  rejectPublish = false;
  /** No relay opens: every subscription ends at once, eose first, as in SimplePool. */
  relaysDown = false;
  /** Relays never report the subscription as open. */
  holdEose = false;

  get openSubscriptions(): number {
    return this.subscriptions.size;
  }

  subscribeMany(
    _relays: string[],
    filter: Filter,
    params: {
      onevent: (event: Event) => void;
      oneose?: () => void;
      onclose?: () => void;
    },
  ): { close: () => void } {
    if (this.relaysDown) {
      params.oneose?.();
      params.onclose?.();
      return { close: () => undefined };
    }
    const subscription = {
      filter,
      onevent: params.onevent,
      onclose: params.onclose,
    };
    this.subscriptions.add(subscription);
    if (!this.holdEose) queueMicrotask(() => params.oneose?.());
    return { close: () => this.subscriptions.delete(subscription) };
  }

  publish(_relays: string[], event: Event): Promise<string>[] {
    if (this.rejectPublish) return [Promise.reject(new Error("rejected"))];
    this.published.push(event);
    for (const subscription of this.subscriptions) {
      const tagged = subscription.filter["#p"] ?? [];
      const addressed = event.tags.some(
        ([name, value]) =>
          name === "p" && value !== undefined && tagged.includes(value),
      );
      if (addressed && subscription.filter.kinds?.includes(event.kind)) {
        queueMicrotask(() => subscription.onevent(event));
      }
    }
    return [Promise.resolve("ok")];
  }

  /** Every relay drops the subscriptions, as when the network goes away. */
  disconnectAll(): void {
    for (const subscription of [...this.subscriptions]) {
      this.subscriptions.delete(subscription);
      subscription.onclose?.();
    }
  }
}

export type SignerBehavior =
  | {
      mode: "sign";
      template?: (requested: LinkauthTemplate) => LinkauthTemplate;
    }
  | { mode: "error"; message: string }
  /** Answers the link with an error instead of the secret. */
  | { mode: "decline"; message: string }
  | { mode: "silent" };

/** A NIP-46 remote signer scripted against the fake relay; `userKey` is the key it signs with. */
export const connectFakeSigner = (
  pool: FakeRelayPool,
  uri: string,
  options: {
    userKey: Uint8Array;
    signerKey: Uint8Array;
    behavior: SignerBehavior;
    secret?: string;
  },
): { signRequests: number } => {
  const link = new URL(uri);
  const clientPubkey = link.hostname;
  const signerPubkey = getPublicKey(options.signerKey);
  const conversationKey = getConversationKey(options.signerKey, clientPubkey);
  const state = { signRequests: 0 };

  const send = (message: object): void => {
    const event = finalizeEvent(
      {
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", clientPubkey]],
        content: encrypt(JSON.stringify(message), conversationKey),
      },
      options.signerKey,
    );
    pool.publish([], event);
  };

  pool.subscribeMany(
    [],
    { kinds: [24133], "#p": [signerPubkey] },
    {
      onevent: (event) => {
        if (!hasValidSignature(event) || event.pubkey !== clientPubkey) return;
        const request: { id: string; method: string; params: string[] } =
          JSON.parse(decrypt(event.content, conversationKey));
        if (request.method !== "sign_event") return;
        state.signRequests += 1;
        const { behavior } = options;
        if (behavior.mode === "silent" || behavior.mode === "decline") return;
        if (behavior.mode === "error") {
          send({ id: request.id, error: behavior.message });
          return;
        }
        const requested: LinkauthTemplate & { created_at: number } = JSON.parse(
          request.params[0] ?? "",
        );
        const template = behavior.template?.(requested) ?? requested;
        send({
          id: request.id,
          result: JSON.stringify(
            signLogin(options.userKey, {
              template,
              createdAt: requested.created_at,
            }),
          ),
        });
      },
    },
  );
  const ackId = bytesToHex(options.signerKey.slice(0, 8));
  // The ack: result is the pairing secret from the link.
  send(
    options.behavior.mode === "decline"
      ? { id: ackId, result: "", error: options.behavior.message }
      : {
          id: ackId,
          result: options.secret ?? link.searchParams.get("secret"),
        },
  );
  return state;
};
