interface PasswordCredentialData {
  readonly id: string;
  readonly name: string;
  readonly password: string;
}

type PasswordCredentialConstructor = new (
  data: PasswordCredentialData,
) => Credential;

export type PasswordManagerSaveResult = "saved" | "unsupported" | "failed";

// PasswordCredential is Chromium-only, so TypeScript's DOM lib leaves it out.
const isPasswordCredential = (
  value: unknown,
): value is PasswordCredentialConstructor => typeof value === "function";

/** Offers a secret to the browser's password manager. */
export const saveToPasswordManager = async (
  credential: PasswordCredentialData,
): Promise<PasswordManagerSaveResult> => {
  const PasswordCredential: unknown = Reflect.get(
    globalThis,
    "PasswordCredential",
  );
  if (!isPasswordCredential(PasswordCredential) || !globalThis.isSecureContext)
    return "unsupported";
  try {
    await navigator.credentials.store(new PasswordCredential(credential));
    return "saved";
  } catch {
    return "failed";
  }
};

/** Offers the recovery seed under the shop's name, or the app's for a nameless shop, keyed by the identity so a re-save updates it. */
export const saveRecoverySeedToPasswordManager = (
  account: { readonly recoverySeed: string; readonly npub: string },
  shopName: string | null,
): Promise<PasswordManagerSaveResult> =>
  saveToPasswordManager({
    id: `fazole.fit:${account.npub}`,
    name: shopName ?? "Fazole",
    password: account.recoverySeed,
  });
