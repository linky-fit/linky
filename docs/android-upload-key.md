# Android Upload Key

Prvni krok pro Google Play release je vygenerovat upload key:

```bash
mkdir -p "$HOME/.keys/linky" && keytool -genkeypair -v -keystore "$HOME/.keys/linky/linky-upload-key.jks" -alias linky-upload -keyalg RSA -keysize 4096 -validity 10000 -storetype JKS -dname "CN=Linky, OU=Mobile, O=Linky, L=Prague, S=Prague, C=CZ"
```

Kratka varianta po radcich:

```bash
mkdir -p "$HOME/.keys/linky"
```

```bash
keytool -genkeypair -v -keystore "$HOME/.keys/linky/linky-upload-key.jks" -alias linky-upload -keyalg RSA -keysize 4096 -validity 10000 -storetype JKS -dname "CN=Linky, OU=Mobile, O=Linky, L=Prague, S=Prague, C=CZ"
```

Po vygenerovani zkopirujte `apps/native-shell/android/keystore.properties.example` na `apps/native-shell/android/keystore.properties` a doplnte hodnoty:

```properties
storeFile=/Users/<you>/.keys/linky/linky-upload-key.jks
storePassword=VASE_HESLO
keyAlias=linky-upload
keyPassword=VASE_HESLO_NEBO_JINE
```

Nenechavejte tam vychozi placeholder `storeFile=/absolute/path/to/linky-upload-key.jks`; release build pak spadne na chybe `Keystore file not found`.

Pak spustte release build:

```bash
bun run native:android:release:check
```

Kdyz kontrola projde, spustte release build:

```bash
bun run native:aab:release
```

Poznamky:

- `google-services.json` neni signing key. Je to Firebase konfigurace pro push notifikace.
- Pokud `bun run native:android:release:check` selze na `keystore.properties`, vytvorte nejdriv lokalni `apps/native-shell/android/keystore.properties` ze vzoru `apps/native-shell/android/keystore.properties.example`.
- `.jks` soubor i hesla zalohujte mimo repozitar.
