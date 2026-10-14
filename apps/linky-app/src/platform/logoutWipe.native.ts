import { Directory } from "expo-file-system";
import { reportAppLog } from "../devtools/inspector/appLog";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import {
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  NOSTR_ATTACHED_NSEC_STORAGE_KEY,
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
} from "../utils/constants";
import {
  safeLocalStorageClear,
  safeLocalStorageGet,
  safeLocalStorageSet,
  safeSessionStorageClear,
} from "../utils/storage";
import { getUnknownErrorMessage } from "../utils/unknown";
import { clearCapacitorStores } from "./capacitorStores.native";
import { databaseDirectoryUri } from "./evoluDatabaseSize.native";
import { secureStore } from "./secureStore.native";

const LOGOUT_PENDING_STORAGE_KEY = "linky.logoutPending";
const SECRET_KEYS = [
  NOSTR_NSEC_STORAGE_KEY,
  NOSTR_ATTACHED_NSEC_STORAGE_KEY,
  NOSTR_SLIP39_SEED_STORAGE_KEY,
  CASHU_BIP85_MNEMONIC_STORAGE_KEY,
  INITIAL_MNEMONIC_STORAGE_KEY,
];
// @evolu/react-native names each database file `evolu1-<name>.db`; Linky's names start with `linky-`.
const isLinkyDatabaseFile = (name: string): boolean =>
  name.startsWith("evolu1-linky-");

export const isLogoutPending = (): boolean =>
  safeLocalStorageGet(LOGOUT_PENDING_STORAGE_KEY) === "1";

/** The app has to reload after this: the boot sees the pending logout and wipes before it opens Evolu. */
export const markLogoutPending = (): void =>
  safeLocalStorageSet(LOGOUT_PENDING_STORAGE_KEY, "1");

/** The native app runs in one context. */
export const onLogoutInAnotherTab: (callback: () => void) => void = () => {};

const deleteDatabaseFiles = (): number => {
  const files = new Directory(databaseDirectoryUri())
    .list()
    .filter((entry) => isLinkyDatabaseFile(entry.name));
  for (const file of files) file.delete();
  return files.length;
};

/** Deletes everything Linky stored on this device: databases, secure-store secrets, then storage. */
export const finishPendingLogout = async (): Promise<void> => {
  if (!isLogoutPending()) return;
  let deletedFiles = 0;
  let failure: string | null = null;
  try {
    deletedFiles = deleteDatabaseFiles();
  } catch (error) {
    failure = getUnknownErrorMessage(error, "deleting databases failed");
    console.warn("[linky][logout] database files not deleted", failure);
  }
  const removals = await Promise.allSettled(
    SECRET_KEYS.map((key) => secureStore.deleteItemAsync(key)),
  );
  const capacitorStoresRemoved = await clearCapacitorStores().then(
    () => true,
    () => false,
  );
  reportAppLog({
    tag: "auth.logoutWiped",
    summary: `Logout wiped ${deletedFiles} database files and the secure-store secrets`,
    payload: {
      deletedFiles,
      failure,
      secretsNotRemoved: SECRET_KEYS.filter(
        (_, index) => removals[index]?.status === "rejected",
      ),
      capacitorStoresRemoved,
    },
  });
  safeSessionStorageClear();
  // Last, so a wipe cut short still finds the pending logout on the next boot.
  safeLocalStorageClear();
};
