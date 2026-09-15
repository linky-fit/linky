import type { AppOwner } from "@evolu/common";
import { createShardStore, type ShardDb, type ShardStore } from "../core";
import type { LinkyDbSchema } from "./schema";
import { linkyScopes, type LinkyScopes } from "./scopes";

export type LinkyStore = ShardStore<LinkyDbSchema, LinkyScopes>;

export const createLinkyStore = (
  db: ShardDb<LinkyDbSchema>,
  appOwner: AppOwner,
): LinkyStore =>
  createShardStore<LinkyDbSchema, LinkyScopes>({
    db,
    appOwner,
    scopes: linkyScopes,
  });
