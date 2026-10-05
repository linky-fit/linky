# Android Play Console CI

Versioned Android releases (a version change in `package.json` on `main`, a manually pushed `v*` tag or a manual run of the `Release · app` workflow) upload the signed AAB to Google Play on the `internal` and `beta` (Open testing) tracks and the APK to GitHub Releases. An ordinary push to `main` does not publish a Play build. The workflow lives in [.github/workflows/release-app.yml](../.github/workflows/release-app.yml); CI sets `versionCode = 200000100 + github.run_number` in [android-release-setup](../.github/actions/android-release-setup/action.yml). Renaming the workflow file restarts `run_number`, so a rename must raise the offset past the last version code.

## Prepare Google Play Console

1. create the app `fit.linky.app` if it does not exist yet
2. set up `Testing` -> `Open testing`, the available countries and the internal track testers
3. finish the store listing and the mandatory forms in the app setup; the account must have access to Open testing
4. in `Publishing overview`, turn off Managed publishing if approved versions should go live automatically

Without the basic setup finished, the Play API can return errors even when the AAB is valid.

## Create a service account for the Play API

In the Google Cloud project linked to the Play Console:

1. open `APIs & Services` -> `Credentials`
2. create a new `Service account`
3. generate a JSON key
4. in the Play Console open `Users and permissions`
5. add the service account and grant it `Release apps to testing tracks` for this app

Store the JSON key contents in the GitHub secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` as plain JSON text.

## Add the upload key secrets

Generate the upload key per [docs/android-upload-key.md](./android-upload-key.md), then base64-encode it:

```bash
base64 -i "$HOME/.keys/linky/linky-upload-key.jks" | pbcopy
```

Add `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS` and `ANDROID_UPLOAD_KEY_PASSWORD` to the GitHub repository secrets.

## Add the Firebase config secret

The Android build uses the FCM push configuration, so also add the base64 contents of `google-services.json` to the GitHub secrets as `ANDROID_GOOGLE_SERVICES_JSON_BASE64`:

```bash
base64 -i apps/native-shell/android/app/google-services.json | pbcopy
```

## Verify the first run

1. release a new version by changing `package.json` and extending `CHANGELOG.md`
2. in GitHub Actions wait for the `Publish to Google Play open testing` job
3. in the Play Console check `Open testing` and `Publishing overview`

## Notes

- Google may review the release; a successful upload does not mean testers get it immediately. With Managed publishing on, an approved release needs manual publication, and some states after a rejection require a manual resubmission for review.
- The AAB also stays available as a GitHub Actions artifact; a failed Play job can be re-run without a new build.
- Testing setup: https://support.google.com/googleplay/android-developer/answer/9845334
- Review and publishing: https://support.google.com/googleplay/android-developer/answer/9859654
