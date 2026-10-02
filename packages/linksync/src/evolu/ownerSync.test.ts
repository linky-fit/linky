import {
  ok,
  SimpleName,
  type CreateWebSocket,
  type OwnerId,
  type WebSocketOptions,
} from "@evolu/common";
import {
  createProtocolMessageBuffer,
  MessageType,
  ProtocolErrorCode,
  type DbWorkerOutput,
} from "@evolu/common/local-first";
import { testAppOwner } from "../testing/toy";
import { reportOwnerSync, type WorkerMessage } from "./dbWorker";
import { trackOwnerSync, type OwnerSyncFailure } from "./ownerSync";

const owner = testAppOwner().id;
const other = testAppOwner(2).id;

const request = (ownerId: OwnerId) =>
  createProtocolMessageBuffer(ownerId, {
    messageType: MessageType.Request,
  }).unwrap();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

const response = (
  ownerId: OwnerId,
  errorCode: (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode] = ProtocolErrorCode.NoError,
) =>
  toArrayBuffer(
    createProtocolMessageBuffer(ownerId, {
      messageType: MessageType.Response,
      errorCode,
    }).unwrap(),
  );

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A relay socket the test answers by hand; `evoluOnMessage` plays Evolu's handler. */
const relaySocket = (
  evoluOnMessage: (data: ArrayBuffer) => void = () => {},
) => {
  let options: WebSocketOptions = {};
  const createWebSocket: CreateWebSocket = (_url, given = {}) => {
    options = given;
    return {
      send: () => ok(),
      getReadyState: () => "open",
      isOpen: () => true,
      [Symbol.dispose]: () => {},
    };
  };
  const synced: OwnerId[] = [];
  const failed: Array<[OwnerId, string, boolean]> = [];
  const socket = reportOwnerSync(
    createWebSocket,
    (ownerId) => synced.push(ownerId),
    (ownerId, error, endsRound) => failed.push([ownerId, error, endsRound]),
  )("wss://relay.example", {
    onMessage: (data) => {
      if (data instanceof ArrayBuffer) evoluOnMessage(data);
    },
  });
  return {
    socket,
    synced,
    failed,
    open: () => options.onOpen?.(),
    receive: (data: ArrayBuffer) => options.onMessage?.(data),
  };
};

describe("reportOwnerSync", () => {
  it("reports an owner once the relay answered its only request", async () => {
    const relay = relaySocket();
    relay.socket.send(request(owner));
    await macrotask();
    expect(relay.synced).toEqual([]);
    relay.receive(response(owner));
    expect(relay.synced).toEqual([]);
    await macrotask();
    expect(relay.synced).toEqual([owner]);
  });

  it("waits for the round Evolu continues from the response", async () => {
    let continued = false;
    const relay = relaySocket(() => {
      if (continued) return;
      continued = true;
      queueMicrotask(() => relay.socket.send(request(owner)));
    });
    relay.socket.send(request(owner));
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([]);
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([owner]);
  });

  it("waits for every request of the owner and ignores other owners", async () => {
    const relay = relaySocket();
    relay.socket.send(request(owner));
    relay.socket.send(request(owner));
    relay.socket.send(request(other));
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([]);
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([owner]);
  });

  it("ends the round at an error response after an error-free one", async () => {
    let continued = false;
    const relay = relaySocket(() => {
      if (continued) return;
      continued = true;
      queueMicrotask(() => relay.socket.send(request(owner)));
    });
    relay.socket.send(request(owner));
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([]);
    relay.receive(response(owner, ProtocolErrorCode.QuotaError));
    await macrotask();
    expect(relay.synced).toEqual([owner]);
    expect(relay.failed).toEqual([[owner, "QuotaError", true]]);
  });

  it("does not end a round at an error after a reconnect dropped the error-free answer", async () => {
    let continued = false;
    const relay = relaySocket(() => {
      if (continued) return;
      continued = true;
      queueMicrotask(() => relay.socket.send(request(owner)));
    });
    relay.socket.send(request(owner));
    relay.receive(response(owner));
    await macrotask();

    relay.open();
    relay.socket.send(request(owner));
    relay.receive(response(owner, ProtocolErrorCode.SyncError));
    await macrotask();
    expect(relay.synced).toEqual([]);
    expect(relay.failed).toEqual([[owner, "SyncError", false]]);
  });

  it("keeps an owner whose first answer is an error unsynced", async () => {
    const relay = relaySocket();
    relay.socket.send(request(owner));
    relay.receive(response(owner, ProtocolErrorCode.SyncError));
    await macrotask();
    expect(relay.synced).toEqual([]);
    expect(relay.failed).toEqual([[owner, "SyncError", false]]);

    relay.open();
    relay.socket.send(request(owner));
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([owner]);
  });

  it("does not count a broadcast", async () => {
    const relay = relaySocket();
    relay.socket.send(request(owner));
    relay.receive(
      toArrayBuffer(
        createProtocolMessageBuffer(other, {
          messageType: MessageType.Broadcast,
        }).unwrap(),
      ),
    );
    await macrotask();
    expect(relay.synced).toEqual([]);
  });

  it("forgets requests a reconnect left unanswered", async () => {
    const relay = relaySocket();
    relay.socket.send(request(owner));
    relay.open();
    relay.socket.send(request(owner));
    relay.receive(response(owner));
    await macrotask();
    expect(relay.synced).toEqual([owner]);
  });
});

describe("trackOwnerSync", () => {
  it("routes the worker's reports to ownerSync and everything else to Evolu", () => {
    const posted: Array<{ readonly type: string }> = [];
    let deliver: (message: WorkerMessage) => void = () => {};
    const { createDbWorker, ownerSync } = trackOwnerSync(() => ({
      postMessage: (message) => posted.push(message),
      onMessage: (callback) => {
        deliver = callback;
      },
    }));
    let notified = 0;
    ownerSync.subscribe(() => {
      notified += 1;
    });
    const failures: OwnerSyncFailure[] = [];
    ownerSync.subscribeFailures((failure) => failures.push(failure));
    const evoluMessages: DbWorkerOutput[] = [];
    createDbWorker(SimpleName.orThrow("linky")).onMessage((message) =>
      evoluMessages.push(message),
    );
    expect(posted).toEqual([{ type: "linksync.ownersSyncedRequest" }]);

    deliver({ type: "linksync.ownersSynced", ownerIds: [owner] });
    deliver({ type: "linksync.ownersSynced", ownerIds: [owner] });
    deliver({ type: "refreshQueries" });
    deliver({
      type: "linksync.ownerSyncFailed",
      ownerId: other,
      error: "WriteKeyError",
      endsRound: false,
    });
    expect([...ownerSync.syncedOwners()]).toEqual([owner]);
    expect(notified).toBe(1);
    expect(failures).toMatchObject([
      { ownerId: other, error: "WriteKeyError", endsRound: false },
    ]);
    expect(evoluMessages).toEqual([{ type: "refreshQueries" }]);
  });
});
