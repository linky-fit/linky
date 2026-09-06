import * as Evolu from "@evolu/common";
import { useQuery } from "@evolu/react";
import React from "react";
import {
  evolu,
  loadEvoluHistoryMutationCounts,
  subscribeEvoluHistoryMutationVersion,
} from "../../evolu";
import {
  CASHU_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
  CONTACTS_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
  EVOLU_CASHU_OWNER_BASELINE_COUNT_STORAGE_KEY,
  EVOLU_CASHU_OWNER_INDEX_STORAGE_KEY,
  EVOLU_CASHU_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
  EVOLU_CONTACTS_OWNER_BASELINE_COUNT_STORAGE_KEY,
  EVOLU_CONTACTS_OWNER_INDEX_STORAGE_KEY,
  EVOLU_CONTACTS_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
  EVOLU_MESSAGES_OWNER_BASELINE_COUNT_STORAGE_KEY,
  EVOLU_MESSAGES_OWNER_INDEX_STORAGE_KEY,
  EVOLU_MESSAGES_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
  EVOLU_TRANSACTIONS_OWNER_BASELINE_COUNT_STORAGE_KEY,
  EVOLU_TRANSACTIONS_OWNER_INDEX_STORAGE_KEY,
  EVOLU_TRANSACTIONS_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
  MAX_CONTACTS_PER_OWNER,
  MESSAGES_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
  OWNER_ROTATION_COOLDOWN_MS,
  TRANSACTIONS_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
} from "../../utils/constants";
import { deriveEvoluOwnerMnemonicFromSlip39 } from "../../utils/slip39Nostr";
import {
  decodeRotationSnapshot,
  encodeRotationSnapshot,
  type RotationSnapshot,
} from "../lib/rotationSnapshot";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageSet,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import { readRowOwnerId } from "../lib/rowOwnerId";
import { UnknownRecord } from "../../utils/schema";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { I18nKey, Translate } from "../../i18n";

type UpsertOwnerMeta = (
  table: "ownerMeta",
  payload: { id: string; scope: string; value: string },
  options: { ownerId: Evolu.OwnerId },
) => Evolu.Result<unknown, unknown>;

type CounterMap = Record<string, number>;

interface RotationSnapshotsByScope {
  cashu: RotationSnapshot | null;
  contacts: RotationSnapshot | null;
  messages: RotationSnapshot | null;
  transactions: RotationSnapshot | null;
}

interface FixedOwnerSyncData {
  identityOwner: Evolu.AppOwner;
  legacyIdentitiesOwner: Evolu.AppOwner;
  legacyMessagesIdentityOwner: Evolu.AppOwner;
  metaOwner: Evolu.AppOwner;
}

interface UseEvoluContactsOwnerRotationParams {
  appOwnerId: Evolu.OwnerId | null;
  isSeedLogin: boolean;
  pushToast: (message: string) => void;
  slip39Seed: string | null;
  t: Translate;
  upsert: UpsertOwnerMeta;
}

interface UseEvoluContactsOwnerRotationResult {
  cashuOwnerId: Evolu.OwnerId | null;
  cashuOwnerEditsUntilRotation: number;
  cashuOwnerIndex: number;
  cashuSyncOwner: Evolu.SyncOwner | null;
  cashuVisibleOwnerIds: Evolu.OwnerId[];
  contactsOwnerEditCount: number;
  contactsOwnerEditsUntilRotation: number;
  contactsOwnerId: Evolu.OwnerId | null;
  contactsSyncOwner: Evolu.SyncOwner | null;
  contactsOwnerIndex: number;
  contactsOwnerNewContactsCount: number;
  contactsOwnerPointer: string;
  contactsVisibleOwnerIds: Evolu.OwnerId[];
  identityOwnerId: Evolu.OwnerId | null;
  identitySyncOwner: Evolu.SyncOwner | null;
  historicalBootstrapSyncOwners: Evolu.SyncOwner[];
  legacyIdentitiesOwnerId: Evolu.OwnerId | null;
  legacyMessagesIdentityOwnerId: Evolu.OwnerId | null;
  metaOwnerId: Evolu.OwnerId | null;
  metaSyncOwner: Evolu.SyncOwner | null;
  messagesOwnerId: Evolu.OwnerId | null;
  messagesOwnerIndex: number;
  messagesOwnerEditsUntilRotation: number;
  messagesSyncOwner: Evolu.SyncOwner | null;
  messagesVisibleOwnerIds: Evolu.OwnerId[];
  requestManualRotateCashuOwner: () => Promise<void>;
  requestManualRotateContactsOwner: () => Promise<void>;
  requestManualRotateMessagesOwner: () => Promise<void>;
  requestManualRotateTransactionsOwner: () => Promise<void>;
  rotateCashuOwnerIsBusy: boolean;
  rotateContactsOwnerIsBusy: boolean;
  rotateMessagesOwnerIsBusy: boolean;
  rotateTransactionsOwnerIsBusy: boolean;
  transactionsOwnerEditsUntilRotation: number;
  transactionsOwnerId: Evolu.OwnerId | null;
  transactionsOwnerIndex: number;
  transactionsOwnerPointer: string;
  transactionsSyncOwner: Evolu.SyncOwner | null;
  transactionsBootstrapSnapshot: ReadonlyArray<object>;
  transactionsVisibleOwnerIds: Evolu.OwnerId[];
}

const createMetaPointerRowId = (scope: string): Evolu.Id =>
  Evolu.createIdFromString<"OwnerMeta">(`owner-pointer-${scope}`);

// Stable identities for the non-seed fallbacks below. Inline `[appOwnerId]` /
// `[]` literals in the returned object gave every render a fresh array, which
// cascaded through visible-owner memo chains into effect deps and caused
// render loops on the unauthenticated shell.
const EMPTY_OWNER_IDS: Evolu.OwnerId[] = [];
const EMPTY_SYNC_OWNERS: Evolu.SyncOwner[] = [];

const readRowPointerValue = (row: unknown): unknown => {
  if (typeof row !== "object" || row === null) return null;
  if (!("value" in row)) return null;
  return row.value;
};

const readRotationSnapshotsByScope = (
  ownerMetaRows: readonly Record<string, unknown>[],
  metaOwnerId: string,
): RotationSnapshotsByScope => {
  const snapshots: RotationSnapshotsByScope = {
    cashu: null,
    contacts: null,
    messages: null,
    transactions: null,
  };

  if (!metaOwnerId) return snapshots;

  for (const row of ownerMetaRows) {
    if (readRowOwnerId(row) !== metaOwnerId) continue;
    const scope =
      typeof row === "object" && row !== null && "scope" in row
        ? row.scope
        : null;
    const scopeText = typeof scope === "string" ? scope.trim() : "";

    if (
      scopeText !== "cashu" &&
      scopeText !== "contacts" &&
      scopeText !== "messages" &&
      scopeText !== "transactions"
    ) {
      continue;
    }

    const decoded = decodeRotationSnapshot(readRowPointerValue(row), scopeText);
    if (!decoded) continue;
    snapshots[scopeText] = decoded;
  }

  return snapshots;
};

const readSnapshotForCurrentIndex = (
  snapshot: RotationSnapshot | null,
  currentIndex: number,
): RotationSnapshot | null => {
  if (!snapshot) return null;
  return snapshot.index === currentIndex ? snapshot : null;
};

const needsStructuredSnapshotUpgrade = (
  snapshot: RotationSnapshot | null,
  currentIndex: number,
): boolean => {
  if (!snapshot) return true;
  if (snapshot.index !== currentIndex) return false;
  return snapshot.baseline === null || snapshot.rotatedAtMs === null;
};

const upsertOwnerMetaSnapshot = (
  upsert: UpsertOwnerMeta,
  ownerId: Evolu.OwnerId,
  scope: "cashu" | "contacts" | "messages" | "transactions",
  snapshot: RotationSnapshot,
) =>
  upsert(
    "ownerMeta",
    {
      id: createMetaPointerRowId(scope),
      scope: Evolu.NonEmptyString100.orThrow(scope),
      value: Evolu.NonEmptyString1000.orThrow(encodeRotationSnapshot(snapshot)),
    },
    { ownerId },
  );

const readCounterMap = (storageKey: string): CounterMap => {
  const out: CounterMap = {};
  for (const [key, value] of Object.entries(
    safeLocalStorageGetJson(storageKey, UnknownRecord, {}),
  )) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[key] = Math.trunc(value);
    }
  }
  return out;
};

const writeCounterMap = (storageKey: string, map: CounterMap): void => {
  safeLocalStorageSetJson(storageKey, map);
};

const getCounterValue = (storageKey: string, index: number): number => {
  const map = readCounterMap(storageKey);
  return Math.trunc(map[String(index)] ?? 0);
};

const setCounterValue = (
  storageKey: string,
  index: number,
  value: number,
): void => {
  const map = readCounterMap(storageKey);
  map[String(index)] = Math.max(0, Math.trunc(value));
  writeCounterMap(storageKey, map);
};

const hasCounterValue = (storageKey: string, index: number): boolean => {
  const map = readCounterMap(storageKey);
  return Object.prototype.hasOwnProperty.call(map, String(index));
};

const readStoredNonNegativeInt = (storageKey: string): number => {
  const raw = Number(safeLocalStorageGet(storageKey));
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.trunc(raw);
};

const writeStoredNonNegativeInt = (storageKey: string, value: number): void => {
  safeLocalStorageSet(storageKey, String(Math.max(0, Math.trunc(value))));
};

const getCooldownRemainingMs = (
  storageKey: string,
  nowMs: number,
  cooldownMs: number,
): number => {
  const lastMs = readStoredNonNegativeInt(storageKey);
  if (lastMs <= 0) return 0;
  const elapsed = Math.max(0, nowMs - lastMs);
  return Math.max(0, cooldownMs - elapsed);
};

const getStoredOptionalIndex = (storageKey: string): number | null => {
  const raw = safeLocalStorageGet(storageKey);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
};

const toAppOwnerFromMnemonic = (mnemonic: string): Evolu.AppOwner | null => {
  const parsed = Evolu.Mnemonic.fromUnknown(mnemonic);
  if (!parsed.ok) return null;
  const secret = Evolu.mnemonicToOwnerSecret(parsed.value);
  return Evolu.createAppOwner(secret);
};

const deriveFixedOwnerSyncDataFromSeed = async (
  slip39Seed: string,
): Promise<FixedOwnerSyncData | null> => {
  const [
    metaMnemonic,
    identityMnemonic,
    legacyIdentitiesMnemonic,
    legacyMessagesIdentityMnemonic,
  ] = await Promise.all([
    deriveEvoluOwnerMnemonicFromSlip39(slip39Seed, "meta", 0),
    deriveEvoluOwnerMnemonicFromSlip39(slip39Seed, "identity", 0),
    // Historical `identities-0` used path family 5, which is now the
    // transactions-0 path family.
    deriveEvoluOwnerMnemonicFromSlip39(slip39Seed, "transactions", 0),
    // Before PR #165, the identity role accidentally fell through here.
    deriveEvoluOwnerMnemonicFromSlip39(slip39Seed, "messages", 0),
  ]);

  if (
    !metaMnemonic ||
    !identityMnemonic ||
    !legacyIdentitiesMnemonic ||
    !legacyMessagesIdentityMnemonic
  )
    return null;

  const metaOwner = toAppOwnerFromMnemonic(metaMnemonic);
  const identityOwner = toAppOwnerFromMnemonic(identityMnemonic);
  const legacyIdentitiesOwner = toAppOwnerFromMnemonic(
    legacyIdentitiesMnemonic,
  );
  const legacyMessagesIdentityOwner = toAppOwnerFromMnemonic(
    legacyMessagesIdentityMnemonic,
  );

  if (
    !metaOwner ||
    !identityOwner ||
    !legacyIdentitiesOwner ||
    !legacyMessagesIdentityOwner
  )
    return null;

  return {
    identityOwner,
    legacyIdentitiesOwner,
    legacyMessagesIdentityOwner,
    metaOwner,
  };
};

type RotatingOwnerRole = "contacts" | "cashu" | "messages" | "transactions";

const deriveVisibleOwnerSyncDataFromSeed = async (
  slip39Seed: string,
  role: RotatingOwnerRole,
  activeOwnerIndex: number,
) => {
  const mnemonics = await Promise.all(
    Array.from({ length: activeOwnerIndex + 1 }, (_value, index) =>
      deriveEvoluOwnerMnemonicFromSlip39(slip39Seed, role, index),
    ),
  );
  const owners = mnemonics.map((mnemonic) =>
    mnemonic ? toAppOwnerFromMnemonic(mnemonic) : null,
  );
  return {
    activeOwner: owners.at(-1) ?? null,
    syncOwners: owners.filter(
      (owner): owner is Evolu.AppOwner => owner !== null,
    ),
  };
};

interface OwnerLaneConfig {
  indexKey: string;
  baselineKey: string;
  rotatedAtKey: string;
  threshold: number;
  rotatedLabel: I18nKey;
  tables: string[];
}

const OWNER_LANES: Record<RotatingOwnerRole, OwnerLaneConfig> = {
  contacts: {
    indexKey: EVOLU_CONTACTS_OWNER_INDEX_STORAGE_KEY,
    baselineKey: EVOLU_CONTACTS_OWNER_BASELINE_COUNT_STORAGE_KEY,
    rotatedAtKey: EVOLU_CONTACTS_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
    threshold: CONTACTS_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
    rotatedLabel: "evoluContactsOwnerRotated",
    tables: ["contact"],
  },
  cashu: {
    indexKey: EVOLU_CASHU_OWNER_INDEX_STORAGE_KEY,
    baselineKey: EVOLU_CASHU_OWNER_BASELINE_COUNT_STORAGE_KEY,
    rotatedAtKey: EVOLU_CASHU_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
    threshold: CASHU_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
    rotatedLabel: "evoluCashuOwnerRotated",
    tables: ["cashuToken"],
  },
  messages: {
    indexKey: EVOLU_MESSAGES_OWNER_INDEX_STORAGE_KEY,
    baselineKey: EVOLU_MESSAGES_OWNER_BASELINE_COUNT_STORAGE_KEY,
    rotatedAtKey: EVOLU_MESSAGES_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
    threshold: MESSAGES_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
    rotatedLabel: "evoluMessagesOwnerRotated",
    tables: ["nostrMessage", "nostrReaction"],
  },
  transactions: {
    indexKey: EVOLU_TRANSACTIONS_OWNER_INDEX_STORAGE_KEY,
    baselineKey: EVOLU_TRANSACTIONS_OWNER_BASELINE_COUNT_STORAGE_KEY,
    rotatedAtKey: EVOLU_TRANSACTIONS_OWNER_LAST_ROTATED_AT_MS_STORAGE_KEY,
    threshold: TRANSACTIONS_OWNER_ROTATION_TRIGGER_WRITE_COUNT,
    rotatedLabel: "evoluTransactionsOwnerRotated",
    tables: ["transaction"],
  },
};

interface UseOwnerLaneParams extends UseEvoluContactsOwnerRotationParams {
  scope: RotatingOwnerRole;
  metaOwner: Evolu.AppOwner | null;
  snapshot: RotationSnapshot | null;
  rows: readonly object[];
  historyCount: number | undefined;
  allowMissingOwnerMetaBootstrap: boolean;
  cashuWriteCount?: number;
}

const countOwnerRows = (rows: readonly object[], ownerId: string): number =>
  ownerId ? rows.filter((row) => readRowOwnerId(row) === ownerId).length : 0;

export const useOwnerLane = ({
  scope,
  appOwnerId,
  isSeedLogin,
  slip39Seed,
  pushToast,
  t,
  upsert,
  metaOwner,
  snapshot,
  rows,
  historyCount,
  allowMissingOwnerMetaBootstrap,
  cashuWriteCount = 0,
}: UseOwnerLaneParams) => {
  const config = OWNER_LANES[scope];
  const [initialIndex] = React.useState(() =>
    scope === "cashu"
      ? (getStoredOptionalIndex(config.indexKey) ??
        readStoredNonNegativeInt(OWNER_LANES.contacts.indexKey))
      : readStoredNonNegativeInt(config.indexKey),
  );
  const [index, setIndex] = React.useState(initialIndex);
  const pendingTarget = React.useRef<number | null>(null);
  const bootstrapRecoveryPending = React.useRef(scope === "cashu");
  const [owner, setOwner] = React.useState<Evolu.AppOwner | null>(null);
  const [visibleOwners, setVisibleOwners] = React.useState<Evolu.SyncOwner[]>(
    [],
  );
  const [isBusy, setIsBusy] = React.useState(false);
  const rotationInFlight = React.useRef(false);
  const resolvedIndex = Math.max(
    snapshot?.index ?? index,
    pendingTarget.current ?? 0,
  );
  const currentSnapshot = readSnapshotForCurrentIndex(snapshot, resolvedIndex);
  const ownerId = isSeedLogin ? (owner?.id ?? null) : appOwnerId;
  const writeCount = React.useMemo(
    () => countOwnerRows(rows, ownerId ?? ""),
    [ownerId, rows],
  );
  const baseline = React.useMemo(
    () =>
      currentSnapshot?.baseline ?? getCounterValue(config.baselineKey, index),
    [config.baselineKey, currentSnapshot, index],
  );
  const editCount = historyCount ?? Math.max(0, writeCount - baseline);

  React.useEffect(() => {
    if (!isSeedLogin || !slip39Seed?.trim()) {
      setOwner(null);
      setVisibleOwners([]);
      return;
    }
    let cancelled = false;
    void deriveVisibleOwnerSyncDataFromSeed(
      slip39Seed.trim(),
      scope,
      resolvedIndex,
    ).then((visible) => {
      if (cancelled) return;
      setOwner(visible.activeOwner);
      setVisibleOwners(visible.syncOwners);
    });
    return () => {
      cancelled = true;
    };
  }, [isSeedLogin, resolvedIndex, scope, slip39Seed]);

  React.useEffect(() => {
    if (!isSeedLogin || !snapshot || !metaOwner) return;
    if (pendingTarget.current !== null) {
      if (snapshot.index < pendingTarget.current) return;
      pendingTarget.current = null;
    }
    if (snapshot.index === index) return;
    writeStoredNonNegativeInt(config.indexKey, snapshot.index);
    setCounterValue(config.baselineKey, snapshot.index, snapshot.baseline ?? 0);
    writeStoredNonNegativeInt(
      config.rotatedAtKey,
      snapshot.rotatedAtMs ?? Date.now(),
    );
    setIndex(snapshot.index);
  }, [config, index, isSeedLogin, metaOwner, snapshot]);

  React.useEffect(() => {
    if (!isSeedLogin || hasCounterValue(config.baselineKey, index)) return;
    setCounterValue(config.baselineKey, index, writeCount);
  }, [config.baselineKey, index, isSeedLogin, writeCount]);

  React.useEffect(() => {
    if (!bootstrapRecoveryPending.current || !isSeedLogin) return;
    if (snapshot || index !== initialIndex) {
      bootstrapRecoveryPending.current = false;
      return;
    }
    if (!allowMissingOwnerMetaBootstrap || !metaOwner || !owner || isBusy)
      return;
    bootstrapRecoveryPending.current = false;
    if (index <= 0 || writeCount > 0) return;
    writeStoredNonNegativeInt(config.indexKey, 0);
    setCounterValue(config.baselineKey, 0, 0);
    writeStoredNonNegativeInt(config.rotatedAtKey, 0);
    setIndex(0);
  }, [
    allowMissingOwnerMetaBootstrap,
    config,
    index,
    initialIndex,
    isBusy,
    isSeedLogin,
    metaOwner,
    owner,
    snapshot,
    writeCount,
  ]);

  React.useEffect(() => {
    if (!isSeedLogin || !metaOwner || !owner) return;
    const shouldWrite = snapshot
      ? needsStructuredSnapshotUpgrade(snapshot, resolvedIndex)
      : allowMissingOwnerMetaBootstrap && resolvedIndex > 0 && writeCount > 0;
    if (!shouldWrite) return;
    upsertOwnerMetaSnapshot(upsert, metaOwner.id, scope, {
      index: resolvedIndex,
      baseline: writeCount,
      cashuBaseline: scope === "contacts" ? cashuWriteCount : null,
      rotatedAtMs: Date.now(),
    });
  }, [
    allowMissingOwnerMetaBootstrap,
    cashuWriteCount,
    isSeedLogin,
    metaOwner,
    owner,
    resolvedIndex,
    scope,
    snapshot,
    upsert,
    writeCount,
  ]);

  const rotate = React.useCallback(async () => {
    if (
      rotationInFlight.current ||
      !isSeedLogin ||
      !slip39Seed?.trim() ||
      !metaOwner
    )
      return;
    const nowMs = Date.now();
    if (
      getCooldownRemainingMs(
        config.rotatedAtKey,
        nowMs,
        OWNER_ROTATION_COOLDOWN_MS,
      ) > 0
    )
      return;
    rotationInFlight.current = true;
    setIsBusy(true);
    try {
      const nextIndex = resolvedIndex + 1;
      const mnemonic = await deriveEvoluOwnerMnemonicFromSlip39(
        slip39Seed.trim(),
        scope,
        nextIndex,
      );
      const nextOwner = mnemonic ? toAppOwnerFromMnemonic(mnemonic) : null;
      if (!nextOwner) {
        pushToast(t("restoreFailed"));
        return;
      }
      const result = upsertOwnerMetaSnapshot(upsert, metaOwner.id, scope, {
        index: nextIndex,
        baseline: 0,
        cashuBaseline: scope === "contacts" ? cashuWriteCount : null,
        rotatedAtMs: nowMs,
      });
      if (!result.ok) {
        pushToast(
          `${t("errorPrefix")}: ${getUnknownErrorMessage(result.error, "unknown")}`,
        );
        return;
      }
      pendingTarget.current = nextIndex;
      writeStoredNonNegativeInt(config.indexKey, nextIndex);
      setCounterValue(
        config.baselineKey,
        nextIndex,
        scope === "contacts" ? 0 : countOwnerRows(rows, nextOwner.id),
      );
      writeStoredNonNegativeInt(config.rotatedAtKey, nowMs);
      setOwner(nextOwner);
      setVisibleOwners((previous) =>
        previous.some((entry) => entry.id === nextOwner.id)
          ? previous
          : [...previous, nextOwner],
      );
      setIndex(nextIndex);
      reportAppLog({
        tag: "evolu.ownerRotated",
        summary: `Rotated ${scope} owner to lane ${nextIndex}`,
        links: { owner: ownerId ? [ownerId, nextOwner.id] : nextOwner.id },
        payload: { scope, previousIndex: resolvedIndex, index: nextIndex },
      });
      pushToast(
        `${t(config.rotatedLabel)}${scope === "contacts" ? "" : " (0)"}`,
      );
    } finally {
      rotationInFlight.current = false;
      setIsBusy(false);
    }
  }, [
    cashuWriteCount,
    config,
    isSeedLogin,
    metaOwner,
    ownerId,
    pushToast,
    resolvedIndex,
    rows,
    scope,
    slip39Seed,
    t,
    upsert,
  ]);

  const requestManualRotate = React.useCallback(async () => {
    if (!isSeedLogin || !slip39Seed?.trim()) {
      pushToast(t("seedMissing"));
      return;
    }
    const remaining = getCooldownRemainingMs(
      config.rotatedAtKey,
      Date.now(),
      OWNER_ROTATION_COOLDOWN_MS,
    );
    if (remaining > 0) {
      pushToast(
        t("evoluRotateCooldown").replace(
          "{seconds}",
          String(Math.ceil(remaining / 1000)),
        ),
      );
      return;
    }
    await rotate();
  }, [config.rotatedAtKey, isSeedLogin, pushToast, rotate, slip39Seed, t]);

  React.useEffect(() => {
    if (!isSeedLogin || isBusy) return;
    if (
      editCount < config.threshold &&
      !(scope === "contacts" && writeCount >= MAX_CONTACTS_PER_OWNER)
    )
      return;
    void rotate();
  }, [
    config.threshold,
    editCount,
    isBusy,
    isSeedLogin,
    rotate,
    scope,
    writeCount,
  ]);

  const visibleOwnerIds = React.useMemo(
    () =>
      isSeedLogin
        ? visibleOwners.map((entry) => entry.id)
        : appOwnerId
          ? [appOwnerId]
          : EMPTY_OWNER_IDS,
    [appOwnerId, isSeedLogin, visibleOwners],
  );
  const historicalOwners = React.useMemo(
    () => visibleOwners.slice(0, -1),
    [visibleOwners],
  );
  return {
    ownerId,
    index: resolvedIndex,
    syncOwner: isSeedLogin ? owner : null,
    visibleOwnerIds,
    historicalOwners,
    isBusy,
    requestManualRotate,
    writeCount,
    editCount,
    editsUntilRotation: Math.max(0, config.threshold - editCount),
    rotatedAtMs: currentSnapshot?.rotatedAtMs ?? 0,
  };
};

export const useEvoluContactsOwnerRotation = (
  params: UseEvoluContactsOwnerRotationParams,
): UseEvoluContactsOwnerRotationResult => {
  const { appOwnerId, isSeedLogin, slip39Seed } = params;
  const [fixedOwnerSyncData, setFixedOwnerSyncData] =
    React.useState<FixedOwnerSyncData | null>(null);
  const [allowMissingOwnerMetaBootstrap, setAllowMissingOwnerMetaBootstrap] =
    React.useState(false);
  const [historyMutationCounts, setHistoryMutationCounts] = React.useState<
    Readonly<Record<string, number>>
  >({});
  const [historyMutationVersion, setHistoryMutationVersion] = React.useState(0);
  const ownerMetaQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("ownerMeta")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const ownerMetaRows = useQuery(ownerMetaQuery);
  const allContactsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("contact")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const allContactsRows = useQuery(allContactsQuery);
  const allCashuTokensQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("cashuToken")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const allCashuTokensRows = useQuery(allCashuTokensQuery);
  const allNostrMessagesQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("nostrMessage")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const allNostrMessagesRows = useQuery(allNostrMessagesQuery);
  const allNostrReactionsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("nostrReaction")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const allNostrReactionsRows = useQuery(allNostrReactionsQuery);
  const allTransactionsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("transaction")
          .selectAll()
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );
  const allTransactionsRows = useQuery(allTransactionsQuery);
  React.useEffect(
    () =>
      subscribeEvoluHistoryMutationVersion(() =>
        setHistoryMutationVersion((value) => value + 1),
      ),
    [],
  );
  React.useEffect(() => {
    if (!isSeedLogin || !slip39Seed?.trim()) {
      setFixedOwnerSyncData(null);
      return;
    }
    let cancelled = false;
    void deriveFixedOwnerSyncDataFromSeed(slip39Seed.trim()).then((derived) => {
      if (!cancelled) setFixedOwnerSyncData(derived);
    });
    return () => {
      cancelled = true;
    };
  }, [isSeedLogin, slip39Seed]);
  React.useEffect(() => {
    setAllowMissingOwnerMetaBootstrap(false);
    if (!isSeedLogin || !fixedOwnerSyncData?.metaOwner.id) return;
    const timer = window.setTimeout(
      () => setAllowMissingOwnerMetaBootstrap(true),
      2500,
    );
    return () => window.clearTimeout(timer);
  }, [fixedOwnerSyncData?.metaOwner.id, isSeedLogin]);
  const metaOwner = fixedOwnerSyncData?.metaOwner ?? null;
  const snapshots = React.useMemo(
    () => readRotationSnapshotsByScope(ownerMetaRows, metaOwner?.id ?? ""),
    [metaOwner?.id, ownerMetaRows],
  );
  const messageRows = React.useMemo(
    () => [...allNostrMessagesRows, ...allNostrReactionsRows],
    [allNostrMessagesRows, allNostrReactionsRows],
  );
  const shared = { ...params, metaOwner, allowMissingOwnerMetaBootstrap };
  const cashu = useOwnerLane({
    ...shared,
    scope: "cashu",
    snapshot: snapshots.cashu,
    rows: allCashuTokensRows,
    historyCount: historyMutationCounts.cashu,
  });
  const contacts = useOwnerLane({
    ...shared,
    scope: "contacts",
    snapshot: snapshots.contacts,
    rows: allContactsRows,
    historyCount: historyMutationCounts.contacts,
    cashuWriteCount: cashu.writeCount,
  });
  const messages = useOwnerLane({
    ...shared,
    scope: "messages",
    snapshot: snapshots.messages,
    rows: messageRows,
    historyCount: historyMutationCounts.messages,
  });
  const transactions = useOwnerLane({
    ...shared,
    scope: "transactions",
    snapshot: snapshots.transactions,
    rows: allTransactionsRows,
    historyCount: historyMutationCounts.transactions,
  });
  React.useEffect(() => {
    const requests = [
      {
        key: "contacts",
        ownerId: contacts.ownerId,
        rotatedAtMs: contacts.rotatedAtMs,
        tables: OWNER_LANES.contacts.tables,
      },
      {
        key: "cashu",
        ownerId: cashu.ownerId,
        rotatedAtMs: cashu.rotatedAtMs,
        tables: OWNER_LANES.cashu.tables,
      },
      {
        key: "messages",
        ownerId: messages.ownerId,
        rotatedAtMs: messages.rotatedAtMs,
        tables: OWNER_LANES.messages.tables,
      },
      {
        key: "transactions",
        ownerId: transactions.ownerId,
        rotatedAtMs: transactions.rotatedAtMs,
        tables: OWNER_LANES.transactions.tables,
      },
    ].flatMap((request) =>
      isSeedLogin && request.ownerId
        ? [{ ...request, ownerId: request.ownerId }]
        : [],
    );
    if (!requests.length) {
      setHistoryMutationCounts((prev) =>
        Object.keys(prev).length ? {} : prev,
      );
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadEvoluHistoryMutationCounts(requests).then((counts) => {
        if (!cancelled) setHistoryMutationCounts(counts);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    cashu.ownerId,
    cashu.rotatedAtMs,
    contacts.ownerId,
    contacts.rotatedAtMs,
    messages.ownerId,
    messages.rotatedAtMs,
    transactions.ownerId,
    transactions.rotatedAtMs,
    historyMutationVersion,
    isSeedLogin,
  ]);
  const historicalBootstrapSyncOwners = React.useMemo(() => {
    if (!isSeedLogin) return EMPTY_SYNC_OWNERS;
    const owners = [
      ...cashu.historicalOwners,
      ...contacts.historicalOwners,
      ...messages.historicalOwners,
      ...transactions.historicalOwners,
    ];
    return owners.filter(
      (owner, index) =>
        owners.findIndex((candidate) => candidate.id === owner.id) === index,
    );
  }, [
    cashu.historicalOwners,
    contacts.historicalOwners,
    messages.historicalOwners,
    transactions.historicalOwners,
    isSeedLogin,
  ]);
  return {
    cashuOwnerId: cashu.ownerId,
    cashuOwnerEditsUntilRotation: cashu.editsUntilRotation,
    cashuOwnerIndex: cashu.index,
    cashuSyncOwner: cashu.syncOwner,
    cashuVisibleOwnerIds: cashu.visibleOwnerIds,
    requestManualRotateCashuOwner: cashu.requestManualRotate,
    rotateCashuOwnerIsBusy: cashu.isBusy,
    contactsOwnerId: contacts.ownerId,
    contactsOwnerEditsUntilRotation: contacts.editsUntilRotation,
    contactsOwnerIndex: contacts.index,
    contactsSyncOwner: contacts.syncOwner,
    contactsVisibleOwnerIds: contacts.visibleOwnerIds,
    requestManualRotateContactsOwner: contacts.requestManualRotate,
    rotateContactsOwnerIsBusy: contacts.isBusy,
    messagesOwnerId: messages.ownerId,
    messagesOwnerEditsUntilRotation: messages.editsUntilRotation,
    messagesOwnerIndex: messages.index,
    messagesSyncOwner: messages.syncOwner,
    messagesVisibleOwnerIds: messages.visibleOwnerIds,
    requestManualRotateMessagesOwner: messages.requestManualRotate,
    rotateMessagesOwnerIsBusy: messages.isBusy,
    transactionsOwnerId: transactions.ownerId,
    transactionsOwnerEditsUntilRotation: transactions.editsUntilRotation,
    transactionsOwnerIndex: transactions.index,
    transactionsSyncOwner: transactions.syncOwner,
    transactionsVisibleOwnerIds: transactions.visibleOwnerIds,
    requestManualRotateTransactionsOwner: transactions.requestManualRotate,
    rotateTransactionsOwnerIsBusy: transactions.isBusy,
    contactsOwnerEditCount: contacts.editCount,
    contactsOwnerNewContactsCount: contacts.writeCount,
    contactsOwnerPointer: `contacts-${contacts.index}`,
    transactionsOwnerPointer: `transactions-${transactions.index}`,
    transactionsBootstrapSnapshot: allTransactionsRows,
    identityOwnerId: isSeedLogin
      ? (fixedOwnerSyncData?.identityOwner.id ?? null)
      : appOwnerId,
    identitySyncOwner: isSeedLogin
      ? (fixedOwnerSyncData?.identityOwner ?? null)
      : null,
    historicalBootstrapSyncOwners,
    legacyIdentitiesOwnerId: isSeedLogin
      ? (fixedOwnerSyncData?.legacyIdentitiesOwner.id ?? null)
      : null,
    legacyMessagesIdentityOwnerId: isSeedLogin
      ? (fixedOwnerSyncData?.legacyMessagesIdentityOwner.id ?? null)
      : null,
    metaOwnerId: isSeedLogin ? (metaOwner?.id ?? null) : null,
    metaSyncOwner: isSeedLogin ? metaOwner : null,
  };
};
