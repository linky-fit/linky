import { isNativePlatform } from "./runtime";

interface PasswordCredentialDataLike {
  id: string;
  name?: string;
  password: string;
}

interface PasswordCredentialInstanceLike {
  readonly id: string;
  readonly type: string;
}

interface PasswordCredentialConstructorLike {
  new (data: PasswordCredentialDataLike): PasswordCredentialInstanceLike;
}

interface TriggerPasswordManagerSeedSaveParams {
  displayName: string;
  password: string;
  username: string;
}

export type PasswordManagerSaveResult = "failed" | "saved" | "unsupported";

const isPasswordCredentialConstructorLike = (
  value: unknown,
): value is PasswordCredentialConstructorLike => {
  return typeof value === "function";
};

const getPasswordCredentialConstructor =
  (): PasswordCredentialConstructorLike | null => {
    const candidate = Reflect.get(globalThis, "PasswordCredential");
    return isPasswordCredentialConstructorLike(candidate) ? candidate : null;
  };

export const triggerPasswordManagerSeedSave = async ({
  displayName,
  password,
  username,
}: TriggerPasswordManagerSeedSaveParams): Promise<PasswordManagerSaveResult> => {
  if (isNativePlatform()) return "unsupported";
  if (typeof window === "undefined") return "unsupported";
  if (typeof navigator === "undefined") return "unsupported";
  if (globalThis.isSecureContext !== true) return "unsupported";

  const PasswordCredentialCtor = getPasswordCredentialConstructor();
  if (!PasswordCredentialCtor) return "unsupported";
  if (!navigator.credentials?.store) return "unsupported";

  const normalizedPassword = password.trim();
  const normalizedUsername = username.trim();
  const normalizedDisplayName = displayName.trim();
  if (!normalizedPassword || !normalizedUsername) return "failed";

  try {
    const credential = new PasswordCredentialCtor({
      id: normalizedUsername,
      ...(normalizedDisplayName ? { name: normalizedDisplayName } : {}),
      password: normalizedPassword,
    });
    await navigator.credentials.store(credential);
    return "saved";
  } catch {
    return "failed";
  }
};
