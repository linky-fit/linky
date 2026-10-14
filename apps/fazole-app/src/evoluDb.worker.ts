import {
  createConsole,
  createRandom,
  createRandomBytes,
  createTime,
  createWebSocket,
} from "@evolu/common";
import { createWasmSqliteDriver } from "@evolu/web";
import { runOwnerSyncDbWorker } from "@linky-fit/linksync/evolu/worker";

runOwnerSyncDbWorker(self, {
  console: createConsole(),
  createSqliteDriver: createWasmSqliteDriver,
  createWebSocket,
  random: createRandom(),
  randomBytes: createRandomBytes(),
  time: createTime(),
});
