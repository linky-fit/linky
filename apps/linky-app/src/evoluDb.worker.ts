// Workers have their own globals, so the page's polyfills cannot protect Evolu.
import "./platform/browserPolyfills";
import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  createWebSocket,
} from "@evolu/common";
import { createWasmSqliteDriver } from "@evolu/web";
import {
  guardOpfsIdle,
  runOwnerSyncDbWorker,
} from "@linky-fit/linksync/evolu/worker";

runOwnerSyncDbWorker(self, {
  console: createConsole(),
  createSqliteDriver: guardOpfsIdle(createWasmSqliteDriver),
  createWebSocket,
  random: createRandom(),
  randomBytes: createRandomBytes(),
  time: createTime(),
});
