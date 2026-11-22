---
name: release-comms
description: Prepare Linky release communications: release blog post, demo videos, blog cover and editable social posts page. Use when preparing a Linky release announcement, social posts, demo videos or release blog post.
---

A release announcement is a blog post in `apps/linky-site` with interactive `@linky-fit/ui` demos, 4:5 videos and a 1280x720 cover captured from those demos, and an editable social posts page on Vercel.

For release `26.11.5`, `<slug>` is `26-11-5` and `<compact>` is `26115`. The last release's article (`apps/linky-site/src/blog/articles/linky-26-11-5/` with its `blog/` and `public/blog/` folders) and demo (`apps/linky-site/src/landing/demo/onchainSend.tsx`) are the template for file layout and wiring.

## Steps

1. Read `apps/linky-app/CHANGELOG.md`, `GLOSSARY.md`, `apps/linky-app/src/i18n/` and the user's focus points. Branch `docs/blog-linky-<slug>` from `origin/main`. Capture scripts, frames and the social posts page live in a temp directory outside git.
2. Delegate in parallel:
   - **Demos** to Claude Opus delegates, one per new demo in `apps/linky-site/src/landing/demo/`, each restricted to its own files. Give each the rules in [Demos](#demos).
   - **Copy** to a Gemini Neon High delegate: the article in English and Czech, plus Slovak when the release concerns Slovak users or the user asks, and the social posts. Give it [Copy](#copy), `GLOSSARY.md` and the `unslop` skill.
3. Register the finished demos in `demo/screens.tsx` and `landing/copy.ts`, then add the article files. Vite discovers the article by its folder name.
4. Capture the videos and `cover.jpg` as in [Capture](#capture). Copy the cover to `apps/linky-site/public/blog/linky-<slug>/cover.jpg`.
5. Look at frames from the opening, middle and final scene of every video, and at `cover.jpg`, beside the current `apps/linky-app` UI. Every scene matches the shipped screens before anything deploys.
6. Build and deploy the [social posts page](#social-posts-page).
7. Run `bun run check-changed`, `bun run test-changed`, `bun run site:build`, then `bun run e2e site` and `bun run e2e down`. Open the PR with the `file-linky-pr` skill, embedding `https://linky-<compact>.twoballers.dev/videos/cover.jpg` in the body.

## Demos

- Build every scene from the current screens in `apps/linky-app/src/pages/` and `src/components/`. Existing demos in `landing/demo/` go stale when the app is redesigned, and a copied old Wallet screen ends up in the video.
- Take copy verbatim from `apps/linky-app/src/i18n/` and colors from `@linky-fit/ui` theme tokens, so the demo works in dark and light mode.
- Export cue timestamps from a separate `<name>Cues.ts`. ESLint's `react-refresh/only-export-components` rejects them in the component file, and the capture script reads them.

## Copy

- Readers are regular users, so describe what changes for them in the product. A library upgrade appears only as its effect, such as steadier sync across devices, without the library's name or version.
- Say `Cashu` or `Cashu tokens`, never `ecash`. In Czech and Slovak on-chain copy say `platba`, never `výplata`.
- An X post is a single post in `@LinkyFit`'s shape: `Linky <version> is out 🚀` (Czech `Vyšel Linky <version> 🚀`), three or four short emoji-led highlights, then `https://linky.fit/blog/linky-<slug>/`. It fits 280 X-weighted characters, where a URL counts 23, an emoji 2 and a Latin character 1.
- Social posts are `X (EN)`, `X (CS)`, `Nostr (EN + CS)` and `Signal (CS)`. Slovak social posts are written only on request.

## Capture

A Playwright script records each demo from the local blog page (`bunx vite --port <port> --strictPort` in `apps/linky-site`, then `/blog/linky-<slug>/`) frame by frame on a virtual clock, so every run produces the same video.

- Viewport `540x675` at `deviceScaleFactor: 2` gives 1080x1350. Set `colorScheme: "dark"` and seed `localStorage` with `linky.color_mode = "dark"` and `linky.lang = "en"`.
- Demos start from an `IntersectionObserver`. Stub it before `page.goto` and fire the callback for the target `figure` once fonts and images have loaded and the clock is paused (`page.clock.install`, `page.clock.pauseAt`).
- Injected CSS hides everything except the target `figure`, its `figcaption` and the cursor.
- Each frame advances `page.clock.runFor(1000 / 30)`, waits one `MessageChannel` tick for React to render, then pauses every Web Animation under the figure (`getAnimations({ subtree: true })`) and sets its `currentTime` to the time since the latest cue. CSS animations ignore the virtual clock, so skipping the seek leaves them frozen or racing.
- Screenshot with `animations: "allow"`, or Playwright fast-forwards the animations to their end.
- Encode with `ffmpeg -framerate 30 -i "%04d.png" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -an <name>.mp4`.
- The cover is the same page in a 1280x720 dark viewport: the demo phones side by side on `rgb(2, 6, 23)` with a faint teal glow, the clock advanced past the last cue and every animation seeked to its end, saved as a 1280x720 `cover.jpg`.

## Social posts page

One self-contained `index.html`, with `videos/*.mp4` and `videos/cover.jpg` beside it and `<meta name="robots" content="noindex">`:

- Each video and the cover has a download link.
- Each post is a `contentEditable="plaintext-only"` block saved to `localStorage` under `linky-<compact>-post:<label>`, with Copy and Reset buttons.
- Each X post shows a live `N / 280` counter using the weights above, highlighted when over the limit.

A `vercel.json` with `"framework": null`, empty `buildCommand` and `installCommand`, and `"outputDirectory": "."` makes Vercel serve the folder as is. `CI=1` stops the CLI from blocking on its upgrade prompt:

```sh
CI=1 vercel link --yes --project "linky-<compact>" --scope david-novaks-projects-ffea9efe
CI=1 vercel deploy --prod --yes --scope david-novaks-projects-ffea9efe
CI=1 vercel domains add "linky-<compact>.twoballers.dev" "linky-<compact>" --scope david-novaks-projects-ffea9efe
```

The page is live once `https://linky-<compact>.twoballers.dev/`, the cover and every video return HTTP 200.
