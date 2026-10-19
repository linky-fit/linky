import { markAwaitingFirstHydration } from "@linky-fit/linksync/evolu";
import { reportAppLog } from "../devtools/inspector/appLog";
import { INITIAL_MNEMONIC_STORAGE_KEY } from "../mnemonic";
import type { PlatformPorts } from "./ports";

const INSTALL_MARKER_KEY = "linky.native.installed";

/**
 * On the first boot of an install. The iOS Keychain outlives an uninstall,
 * so a reinstalled app can find the account's secrets with an empty
 * database: it then waits for the account's first hydration, as a restore
 * does, instead of writing over the synced data.
 */
export const adoptSecretsFromPreviousInstall = async ({
  kv,
  secrets,
}: Pick<PlatformPorts, "kv" | "secrets">): Promise<void> => {
  if (kv.getItem(INSTALL_MARKER_KEY) === "1") return;
  const appMnemonic = await secrets.read(INITIAL_MNEMONIC_STORAGE_KEY);
  // An unreadable store tells nothing yet; the next boot asks again.
  if (appMnemonic._tag === "Unavailable") return;
  if (appMnemonic._tag === "Found") {
    markAwaitingFirstHydration(kv, appMnemonic.value);
    reportAppLog({
      tag: "session.reinstallAwaitingHydration",
      summary:
        "Found the account's secrets from a previous install; holding writes until its data syncs",
      payload: {},
    });
  }
  kv.setItem(INSTALL_MARKER_KEY, "1");
};
