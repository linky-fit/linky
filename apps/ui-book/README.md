# Linky UI book

A single scrolling Expo catalog of every component exported by `@linky-fit/ui`, grouped like the library README with one module per group in `src/sections`. `Amount` appears under payments. The tokens section reads the exported token scales and every theme. Each example is its own component with fictional data and local state.

From the repo root:

```sh
bun install
bun run ui:dev
```

Web uses port 5287. Expo prompts if the port is occupied; stop instead of accepting a different port. Pick the light, dark or fazole theme at the top. Open dialogs, sheets, the guided tour and success feedback from their buttons. Press a success overlay to close it. The camera preview runs on the web only, after you allow camera access.

For native, run `bun run --filter @linky-fit/ui-book start` and scan the QR with Expo Go for SDK 57, or run the workspace `ios` or `android` script with a simulator available. Metro uses Expo's default monorepo configuration. Manrope's regular, semibold and bold families load before the catalog renders.

```sh
bun run check-code
bun run --filter @linky-fit/ui-book test
```

The small coverage test imports the component sections and compares their entry names with the public component exports, including providers, rejecting missing or duplicate entries.
