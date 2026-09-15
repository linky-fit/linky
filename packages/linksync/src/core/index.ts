export {
  appScope,
  forgottenIndexes,
  shardScope,
  visibleIndexes,
} from "./scope";
export type {
  AppScope,
  ForgetPolicy,
  RotationRule,
  ScopeDefinition,
  ScopeRegistry,
  ShardScope,
} from "./scope";
export { ShardDbError } from "./ShardDb";
export type {
  Columns,
  DbSchema,
  Mutation,
  OwnerUsage,
  Patch,
  Row,
  ShardDb,
  SystemColumns,
  WriteRow,
} from "./ShardDb";
export { makeInMemoryShardDb } from "./inMemoryShardDb";
export type { InMemoryShardDb, TableColumns } from "./inMemoryShardDb";
export {
  createShardStore,
  mergeShardRows,
  RowNotFound,
  shardPointerId,
  UnknownScope,
} from "./shardStore";
export type {
  CoreSchema,
  ForgottenShard,
  RotationOutcome,
  Shard,
  ShardPointerColumns,
  ShardStore,
  ShardStoreOptions,
} from "./shardStore";
