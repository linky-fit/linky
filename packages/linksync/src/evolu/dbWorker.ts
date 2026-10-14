import type { CreateWebSocket, OwnerId, Worker } from "@evolu/common";
import {
  createBuffer,
  idBytesTypeValueLength,
  OwnerIdBytes,
  ownerIdBytesToOwnerId,
} from "@evolu/common";
import {
  createDbWorkerForPlatform,
  decodeNonNegativeInt,
  MessageType,
  ProtocolErrorCode,
  type DbWorkerInput,
  type DbWorkerOutput,
  type DbWorkerPlatformDeps,
} from "@evolu/common/local-first";
import { distinctMillis } from "../core/distinctMillis";

export { guardOpfsIdle } from "./opfsIdleGuard";

/**
 * Evolu 7 syncs in its database worker and tells the page nothing about it, so
 * the worker taps its relay sockets instead. Evolu reconciles an owner in
 * request and response rounds, a relay answers every request, and the client
 * sends its next request from the microtasks of the response it got. An owner
 * whose last response leaves no request unanswered by the next macrotask has
 * nothing left to reconcile with that relay. A response carrying a protocol
 * error ends the round too, since Evolu does not continue from it, but only
 * once the relay has answered the owner without an error on the current
 * connection: only then has what it holds arrived.
 */

export interface OwnersSynced {
  readonly type: "linksync.ownersSynced";
  readonly ownerIds: ReadonlyArray<OwnerId>;
}

export interface OwnersSyncedRequest {
  readonly type: "linksync.ownersSyncedRequest";
}

/** A relay answered a request for the owner with a protocol error. */
export interface OwnerSyncFailed {
  readonly type: "linksync.ownerSyncFailed";
  readonly ownerId: OwnerId;
  /** Evolu's `ProtocolErrorCode` name, such as `QuotaError`. */
  readonly error: string;
  /** False while the relay has not yet answered the owner without an error; the owner then stays unsynced. */
  readonly endsRound: boolean;
}

export type PageMessage = DbWorkerInput | OwnersSyncedRequest;
export type WorkerMessage = DbWorkerOutput | OwnersSynced | OwnerSyncFailed;

interface ProtocolHeader {
  readonly ownerId: OwnerId;
  readonly messageType: number;
  readonly errorCode: number | null;
}

const readHeader = (bytes: Uint8Array): ProtocolHeader | null => {
  try {
    const buffer = createBuffer(bytes);
    decodeNonNegativeInt(buffer);
    const ownerId = ownerIdBytesToOwnerId(
      OwnerIdBytes.orThrow(buffer.shiftN(idBytesTypeValueLength)),
    );
    const messageType = buffer.shift();
    return {
      ownerId,
      messageType,
      errorCode: messageType === MessageType.Response ? buffer.shift() : null,
    };
  } catch {
    return null;
  }
};

const errorName = (errorCode: number | null): string =>
  Object.entries(ProtocolErrorCode).find(
    ([, code]) => code === errorCode,
  )?.[0] ?? String(errorCode);

/** Evolu's `createWebSocket`, reporting each owner whose reconciliation with the relay finished, and each protocol error. */
export const reportOwnerSync =
  (
    createWebSocket: CreateWebSocket,
    onSynced: (ownerId: OwnerId) => void,
    onFailed: (
      ownerId: OwnerId,
      error: string,
      endsRound: boolean,
    ) => void = () => {},
  ): CreateWebSocket =>
  (url, options = {}) => {
    const unanswered = new Map<OwnerId, number>();
    const answeredWithoutError = new Set<OwnerId>();
    const socket = createWebSocket(url, {
      ...options,
      onOpen: () => {
        // A request sent before a reconnect is never answered; Evolu syncs every owner again on open.
        unanswered.clear();
        answeredWithoutError.clear();
        options.onOpen?.();
      },
      onMessage: (data) => {
        options.onMessage?.(data);
        if (!(data instanceof ArrayBuffer)) return;
        const header = readHeader(new Uint8Array(data));
        if (header?.messageType !== MessageType.Response) return;
        const { ownerId } = header;
        unanswered.set(
          ownerId,
          Math.max(0, (unanswered.get(ownerId) ?? 0) - 1),
        );
        if (header.errorCode === ProtocolErrorCode.NoError)
          answeredWithoutError.add(ownerId);
        else {
          const endsRound = answeredWithoutError.has(ownerId);
          onFailed(ownerId, errorName(header.errorCode), endsRound);
          if (!endsRound) return;
        }
        setTimeout(() => {
          if ((unanswered.get(ownerId) ?? 0) === 0) onSynced(ownerId);
        }, 0);
      },
    });
    return {
      ...socket,
      send: (data) => {
        const result = socket.send(data);
        const header =
          result.ok && data instanceof Uint8Array ? readHeader(data) : null;
        if (header?.messageType === MessageType.Request)
          unanswered.set(
            header.ownerId,
            (unanswered.get(header.ownerId) ?? 0) + 1,
          );
        return result;
      },
    };
  };

/** The worker global the database worker runs in. */
export interface DbWorkerScope {
  readonly postMessage: (message: WorkerMessage) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: { readonly data: PageMessage }) => void,
  ) => void;
}

/**
 * Runs Evolu's database worker in `scope` and reports the owners whose sync
 * round with a relay finished, and every protocol error a relay answered; an
 * owner without a relay to sync with counts as synced once used. Each write
 * gets its own millisecond, so rows it stores in a burst keep distinct
 * `createdAt` times in the order written. Pair it with
 * `trackOwnerSync` on the page. A separate
 * entry (`@linky-fit/linksync/evolu/worker`) keeps the store out of the worker bundle.
 */
export const runOwnerSyncDbWorker = (
  scope: DbWorkerScope,
  deps: DbWorkerPlatformDeps,
): void => {
  const synced = new Set<OwnerId>();
  let relayCount: number | null = null;
  const report = (ownerIds: ReadonlyArray<OwnerId>) =>
    scope.postMessage({ type: "linksync.ownersSynced", ownerIds });
  const markSynced = (ownerId: OwnerId) => {
    if (synced.has(ownerId)) return;
    synced.add(ownerId);
    report([ownerId]);
  };
  const writeMillis = distinctMillis();
  const dbWorker = createDbWorkerForPlatform({
    ...deps,
    // Evolu stamps a written row's createdAt with the millisecond `now` gave its write.
    time: { ...deps.time, now: () => writeMillis(deps.time.now()) },
    createWebSocket: reportOwnerSync(
      deps.createWebSocket,
      markSynced,
      (ownerId, error, endsRound) =>
        scope.postMessage({
          type: "linksync.ownerSyncFailed",
          ownerId,
          error,
          endsRound,
        }),
    ),
  });
  dbWorker.onMessage((message) => scope.postMessage(message));
  scope.addEventListener("message", ({ data }) => {
    if (data.type === "linksync.ownersSyncedRequest") {
      report([...synced]);
      return;
    }
    if (data.type === "init") relayCount = data.config.transports.length;
    if (
      data.type === "useOwner" &&
      data.use &&
      (data.owner.transports?.length ?? relayCount) === 0
    )
      markSynced(data.owner.id);
    dbWorker.postMessage(data);
  });
};

/**
 * Runs the owner-sync database worker in this thread, for runtimes without
 * workers such as React Native; hand it to `trackOwnerSync`.
 */
export const createInProcessOwnerSyncDbWorker = (
  deps: DbWorkerPlatformDeps,
): Worker<PageMessage, WorkerMessage> => {
  let toPage: ((message: WorkerMessage) => void) | null = null;
  // Queued until the page listens, since trackOwnerSync asks for the synced
  // owners before Evolu subscribes.
  const queued: WorkerMessage[] = [];
  // Each message in its own microtask, as events across a real worker: page
  // callbacks may call back into the worker while it is still inside a SQLite
  // transaction, and one that throws loses only its own message.
  const deliver = (message: WorkerMessage) =>
    queueMicrotask(() => toPage?.(message));
  let toWorker: (event: { readonly data: PageMessage }) => void = () => {};
  runOwnerSyncDbWorker(
    {
      postMessage: (message) => {
        if (toPage) deliver(message);
        else queued.push(message);
      },
      addEventListener: (_type, listener) => {
        toWorker = listener;
      },
    },
    deps,
  );
  return {
    postMessage: (data) => toWorker({ data }),
    onMessage: (callback) => {
      toPage = callback;
      for (const message of queued.splice(0)) deliver(message);
    },
  };
};
