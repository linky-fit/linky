import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import type { Page } from "@playwright/test";

import { EVOLU_RELAY_URL } from "./stack";

const keys = {
  user: "linky.evoluServers.user.v1",
  disabled: "linky.evoluServers.disabled.v1",
  local: EVOLU_RELAY_URL,
  released: "e2e.evolu-released",
};

const WEBSOCKET_ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface SilentEvoluRelay {
  readonly url: string;
  /** Whether a device has sent the relay anything, such as a sync request. */
  readonly hasReceivedRequest: () => boolean;
  readonly close: () => Promise<void>;
}

/** An Evolu relay that accepts WebSocket connections and never answers. */
export const startSilentEvoluRelay = async (): Promise<SilentEvoluRelay> => {
  const sockets = new Set<Socket>();
  let receivedBytes = 0;
  const server = createServer();
  server.on("upgrade", (request, socket: Socket) => {
    sockets.add(socket);
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}${WEBSOCKET_ACCEPT_GUID}`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    socket.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("the silent Evolu relay has no port");
  return {
    url: `ws://localhost:${address.port}`,
    hasReceivedRequest: () => receivedBytes > 0,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
};

/** Points the device at `relay` instead of the real Evolu relay, until `releaseEvoluRelay`. */
export const holdEvoluRelay = (
  page: Page,
  relay: SilentEvoluRelay,
): Promise<void> =>
  page.addInitScript(
    ({ names, url }) => {
      if (sessionStorage.getItem(names.released) === "1") return;
      localStorage.setItem(names.user, JSON.stringify([url]));
      localStorage.setItem(names.disabled, JSON.stringify([names.local]));
    },
    { names: keys, url: relay.url },
  );

/** Restores the real Evolu relay; the reload is what reconnects. */
export const releaseEvoluRelay = async (page: Page): Promise<void> => {
  await page.evaluate((names) => {
    sessionStorage.setItem(names.released, "1");
    localStorage.removeItem(names.user);
    localStorage.removeItem(names.disabled);
  }, keys);
  await page.reload();
};
