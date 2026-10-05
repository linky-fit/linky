# @linky-fit/desktop

Beta Electron shell for macOS on Apple Silicon. It loads `https://app.linky.fit`, so the web app updates through its service worker as in a browser.

- Closing the window hides it and removes the dock icon; Linky keeps running in the menu bar so relay subscriptions stay alive and notifications keep arriving. Quit from the menu bar icon or with Cmd+Q. The first launch from `/Applications` turns on "Open at login".
- Notifications go through the `window.linkyDesktop.notify` preload bridge, because Electron does not display service worker notifications. Electron has no Web Push service, so the web app hides its push switch here and the running app delivers notifications instead.
- The title bar is hidden; the preload sets `--safe-area-top` so the page's top bar runs under the window buttons, and adds a drag strip there.
- The shell checks GitHub Releases on start and every 4 hours. A newer release with `linky-mac-arm64.dmg` shows a notification and a "Download Linky …" menu item that opens the DMG; the user replaces Linky in Applications.

## Development

```bash
bun run dev                 # web app on http://localhost:5173
bun run desktop:dev         # shell pointed at it (LINKY_DESKTOP_URL overrides)
```

Shells that run inside Electron (T3 Code) export `ELECTRON_RUN_AS_NODE=1`; unset it or Electron starts as plain Node.

## Building

```bash
bun run desktop:mac         # apps/desktop/release/linky-mac-arm64.dmg
```

The version comes from the root `package.json`. The build is ad-hoc signed and not notarized, so on first launch macOS refuses to open it until the user allows it in System Settings > Privacy & Security > "Open Anyway", and again after each downloaded update.

Developer ID signing and notarization would allow in-place updates (electron-updater) and a clean first launch. They need a "Developer ID Application" certificate and an App Store Connect API key from Apple team `2K8ST4234F`.

## Releases

The `macos` job in `.github/workflows/release-app.yml` builds the DMG after the release exists and uploads `linky-mac-arm64.dmg` to it. `.github/workflows/ci-desktop.yml` builds it for pull requests that touch `apps/desktop` and keeps the DMG as a workflow artifact.

The app name and `appId` (`fit.linky.desktop`) decide where Electron keeps the local Evolu data (`~/Library/Application Support/Linky`); renaming either strands existing users' data.
