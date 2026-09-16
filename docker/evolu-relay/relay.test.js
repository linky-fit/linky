import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import { OwnerId, OwnerWriteKey } from "@evolu/common";
import {
  createProtocolMessageBuffer,
  createTimestamp,
  MessageType,
  ProtocolErrorCode,
  SubscriptionFlags,
} from "@evolu/common/local-first";
import { WebSocket } from "ws";

import { DEFAULT_OWNER_QUOTA_BYTES, readOwnerQuotaBytes } from "./config.js";

const ownerId = OwnerId.orThrow(Buffer.alloc(16, 1).toString("base64url"));
const otherOwnerId = OwnerId.orThrow(Buffer.alloc(16, 2).toString("base64url"));
const writeKey = OwnerWriteKey.orThrow(new Uint8Array(16).fill(3));
const indexPath = fileURLToPath(new URL("index.js", import.meta.url));

function writeMessage(owner, size, millis) {
  const message = createProtocolMessageBuffer(owner, {
    messageType: MessageType.Request,
    subscriptionFlag: SubscriptionFlags.Subscribe,
    writeKey,
  });
  message.addMessage({
    timestamp: createTimestamp({ millis }),
    change: new Uint8Array(size).fill(4),
  });
  return message.unwrap();
}

async function exchange(
  socket,
  message,
  owner,
  errorCode = ProtocolErrorCode.NoError,
) {
  const response = once(socket, "message");
  socket.send(message);
  const [received] = await response;
  const expected = createProtocolMessageBuffer(owner, {
    messageType: MessageType.Response,
    errorCode,
  }).unwrap();
  assert.deepEqual(new Uint8Array(received), expected);
}

async function startRelay(quota) {
  const cwd = await mkdtemp(join(tmpdir(), "linky-evolu-quota-"));
  const env = { ...process.env };
  delete env.EVOLU_OWNER_QUOTA_BYTES;
  if (quota !== undefined) env.EVOLU_OWNER_QUOTA_BYTES = quota;
  const child = spawn(process.execPath, [indexPath], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const close = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
    await rm(cwd, { recursive: true, force: true });
  };
  return { child, exited, output: () => output, close };
}

async function withRelay(quota, run) {
  const relay = await startRelay(quota);
  let socket;
  try {
    const deadline = Date.now() + 5000;
    while (!relay.output().includes("[evolu-relay] ready")) {
      assert.equal(relay.child.exitCode, null, relay.output());
      assert.ok(
        Date.now() < deadline,
        `Relay startup timed out: ${relay.output()}`,
      );
      await setTimeout(10);
    }
    socket = new WebSocket("ws://127.0.0.1:4000");
    await once(socket, "open");
    await run(socket, relay);
  } finally {
    socket?.terminate();
    await relay.close();
  }
  return relay.output();
}

test("quota defaults to 100 MiB and accepts only explicit decimal overrides", () => {
  assert.equal(readOwnerQuotaBytes({}), 100 * 1024 * 1024);
  assert.equal(DEFAULT_OWNER_QUOTA_BYTES, 104857600);
  for (const value of ["0", "16384", "104857600"]) {
    assert.equal(
      readOwnerQuotaBytes({ EVOLU_OWNER_QUOTA_BYTES: value }),
      Number(value),
    );
  }
  for (const value of [
    "",
    " ",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "0x10",
    "1e6",
    "12bytes",
    "9007199254740992",
  ]) {
    assert.throws(
      () => readOwnerQuotaBytes({ EVOLU_OWNER_QUOTA_BYTES: value }),
      /non-negative safe integer/,
    );
  }
});

test(
  "real relay enforces cumulative per-owner quota without logging owners or malformed messages",
  { timeout: 10000 },
  async () => {
    const logs = await withRelay("128", async (socket, relay) => {
      await exchange(socket, writeMessage(ownerId, 96, 1), ownerId);
      await exchange(socket, writeMessage(ownerId, 32, 2), ownerId);
      await exchange(
        socket,
        writeMessage(ownerId, 1, 3),
        ownerId,
        ProtocolErrorCode.QuotaError,
      );
      await exchange(socket, writeMessage(otherOwnerId, 96, 1), otherOwnerId);
      const malformed = writeMessage(otherOwnerId, 1, 2);
      socket.send(malformed.subarray(0, malformed.length - 1));
      const deadline = Date.now() + 2000;
      while (!relay.output().includes("invalid protocol message")) {
        assert.ok(Date.now() < deadline, relay.output());
        await setTimeout(10);
      }
    });
    assert.match(logs, /ownerQuotaBytes=128/);
    assert.match(logs, /invalid protocol message/);
    assert.match(logs, /shutting down/);
    for (const privateValue of [
      ownerId,
      otherOwnerId,
      "data:",
      "ownerId:",
      "Uint8Array",
      "subscribe",
      "broadcast",
    ]) {
      assert.ok(!logs.includes(privateValue), logs);
    }
  },
);

test(
  "default and explicit zero start successfully and preserve the unlimited dev override",
  { timeout: 10000 },
  async () => {
    const defaults = await withRelay(undefined, (socket) =>
      exchange(socket, writeMessage(ownerId, 256, 1), ownerId),
    );
    assert.match(defaults, /ownerQuotaBytes=104857600/);
    const unlimited = await withRelay("0", async (socket) => {
      await exchange(socket, writeMessage(ownerId, 256, 1), ownerId);
      await exchange(socket, writeMessage(ownerId, 256, 2), ownerId);
    });
    assert.match(unlimited, /ownerQuotaBytes=unlimited/);
  },
);

test(
  "invalid quota aborts startup before serving clients",
  { timeout: 10000 },
  async () => {
    for (const quota of ["", "-1", "9007199254740992"]) {
      const relay = await startRelay(quota);
      try {
        const [code] = await relay.exited;
        assert.notEqual(code, 0);
        assert.match(relay.output(), /non-negative safe integer/);
        assert.ok(!relay.output().includes("ready"));
      } finally {
        await relay.close();
      }
    }
  },
);
