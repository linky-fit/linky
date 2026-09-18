import type { AppOwner } from "@evolu/common";
import {
  createShardStore,
  type ShardDb,
  type ShardStore,
  type ShardRetention,
} from "../core";
import type { LinkyDbSchema } from "./schema";
import { linkyScopes, type LinkyScopes } from "./scopes";

export type LinkyStore = ShardStore<LinkyDbSchema, LinkyScopes>;

export const createLinkyStore = (
  db: ShardDb<LinkyDbSchema>,
  appOwner: AppOwner,
  options: {
    readonly scopes?: LinkyScopes;
    readonly retention?: ShardRetention;
  } = {},
): LinkyStore =>
  createShardStore<LinkyDbSchema, LinkyScopes>({
    db,
    appOwner,
    scopes: options.scopes ?? linkyScopes,
    ...(options.retention ? { retention: options.retention } : {}),
  });
