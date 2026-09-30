# Android Upload Key

The first step of a Google Play release is generating the upload key:

```bash
mkdir -p "$HOME/.keys/linky" && keytool -genkeypair -v -keystore "$HOME/.keys/linky/linky-upload-key.jks" -alias linky-upload -keyalg RSA -keysize 4096 -validity 10000 -storetype JKS -dname "CN=Linky, OU=Mobile, O=Linky, L=Prague, S=Prague, C=CZ"
```

After generating it, copy `apps/native-shell/android/keystore.properties.example` to `apps/native-shell/android/keystore.properties` and fill in the values:

```properties
storeFile=/Users/<you>/.keys/linky/linky-upload-key.jks
storePassword=YOUR_PASSWORD
keyAlias=linky-upload
keyPassword=YOUR_PASSWORD_OR_A_DIFFERENT_ONE
```

Do not leave the default placeholder `storeFile=/absolute/path/to/linky-upload-key.jks` in place; the release build then fails with `Keystore file not found`.

Then verify the configuration:

```bash
bun run native:android:release:check
```

When the check passes, run the release build:

```bash
bun run native:aab:release
```

Notes:

- `google-services.json` is not a signing key. It is the Firebase configuration for push notifications.
- If `bun run native:android:release:check` fails on `keystore.properties`, first create the local `apps/native-shell/android/keystore.properties` from the template `apps/native-shell/android/keystore.properties.example`.
- Back up the `.jks` file and the passwords outside the repository.
