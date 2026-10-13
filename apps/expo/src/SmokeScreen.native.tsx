import {
  deriveOwnerMnemonicsFromMasterSecret,
  IdentityProvider,
  MasterSecretProvider,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
} from "@linky-fit/identity";
import { encodeNpub } from "@linky-fit/linkstr";
import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import { Card, ScrollView, Screen, Text, UIProvider } from "@linky-fit/ui";
import { Effect } from "effect";
import { useEffect, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// Temporary smoke screen proving the native toolchain until the app boots here.

/** The cross-app vector share from packages/identity/src/crossAppDerivation.test.ts. */
const vectorShare =
  "item lilac academic academic armed dress review premium imply typical dominant daisy voting random agency bike dive being coastal rocky";

const deriveVectorIdentity = Effect.gen(function* () {
  const started = performance.now();
  const share = yield* parseSlip39Share(vectorShare);
  const masterSecret = yield* recoverMasterSecretFromSlip39Share(share);
  const { nostrPublicKey } = yield* IdentityProvider.pipe(
    Effect.provide(IdentityProvider.layer),
    Effect.provide(MasterSecretProvider.fromSlip39Share(share)),
  );
  const [appMnemonic = ""] = yield* deriveOwnerMnemonicsFromMasterSecret(
    masterSecret,
    [{ role: "meta" }],
  );
  return [
    ["npub", encodeNpub(nostrPublicKey)],
    ["appMnemonic", appMnemonic],
    ["AppOwner", appOwnerFromMnemonic(appMnemonic)?.id ?? "not a mnemonic"],
    ["derivation", `${Math.round(performance.now() - started)} ms`],
  ] as const;
});

const aesGcmRoundTrip = async (): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const message = crypto.randomUUID();
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(message),
  );
  const opened = new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed),
  );
  return opened === message ? `ok, ${sealed.byteLength} bytes` : "mismatch";
};

const runSmokeChecks = async (): Promise<
  ReadonlyArray<readonly [string, string]>
> => [
  ...(await Effect.runPromise(deriveVectorIdentity)),
  ["AES-GCM", await aesGcmRoundTrip()],
];

export function SmokeScreen() {
  const [rows, setRows] = useState<ReadonlyArray<readonly [string, string]>>([
    ["status", "running"],
  ]);
  useEffect(() => {
    runSmokeChecks().then(setRows, (error: unknown) =>
      setRows([["error", String(error)]]),
    );
  }, []);
  return (
    <SafeAreaProvider>
      <UIProvider mode="light">
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView>
            <Screen>
              <Text variant="title">Linky native smoke</Text>
              {rows.map(([label, value]) => (
                <Card key={label} outlined>
                  <Text eyebrow>{label}</Text>
                  <Text mono selectable>
                    {value}
                  </Text>
                </Card>
              ))}
            </Screen>
          </ScrollView>
        </SafeAreaView>
      </UIProvider>
    </SafeAreaProvider>
  );
}
