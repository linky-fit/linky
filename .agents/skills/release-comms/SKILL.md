---
name: release-comms
description: Prepare Linky release communications: release blog post, demo videos, blog cover and editable social posts page. Use when preparing a Linky release announcement, social posts, demo videos or release blog post.
---

Prepare a Linky release announcement end to end: interactive `@linky-fit/ui` demos in the `apps/linky-site` blog post, 4:5 demo videos and a 1280x720 blog cover captured from those demos, an editable static social posts page on Vercel, and a ready-for-review blog PR.

Notation used below for a release such as `26.11.5`:

- `<version>`: `26.11.5`
- `<slug>`: `26-11-5` (branch, blog folder and `linky.fit/blog/linky-<slug>/`)
- `<compact>`: `26115` (Vercel project, subdomain `linky-<compact>.twoballers.dev`, and `localStorage` prefix)

## Steps

1. **Gather inputs and branch cleanly.** Read `apps/linky-app/CHANGELOG.md`, `GLOSSARY.md`, `apps/linky-app/src/i18n/` and the user's focus points. Create the blog branch from `origin/main` (`git fetch origin main && git checkout -b docs/blog-linky-<slug> origin/main`). Keep capture scripts and the static social posts site in a temp directory outside git (for example `/tmp/linky-<compact>` and `/tmp/linky-<compact>-site`).
2. **Delegate mockups and copy in parallel.**
   - **Interactive mockups.** Delegate each new `@linky-fit/ui` demo (`apps/linky-site/src/landing/demo/<name>.tsx`) to a Claude Opus delegate (`claudeAgent` / `claude-opus-5-5` when available). Restrict each delegate to its own demo files. Build every scene from the current screens in `apps/linky-app/src/pages/` and `apps/linky-app/src/components/`. Never copy older screens from `apps/linky-site/src/landing/demo/home.tsx` or earlier release demos without checking whether the app UI changed, because an outdated screen such as a pre-redesign Wallet view leaks old UI into the captured video. Export cue timestamps from a separate `<name>Cues.ts` file so `react-refresh/only-export-components` stays happy. Require exact copy from `apps/linky-app/src/i18n/`, `@linky-fit/ui` theme tokens only (working in both dark and light mode), and visual checks of every scene in both themes.
   - **Copy.** Delegate the blog article (`en.tsx`, `cs.tsx`, plus `sk.tsx` only when relevant or requested) and social posts to a Gemini 4 Neon High delegate (`antigravity` / `gemini-4-neon`, `thought_level: "high"` when available). Pass all rules in [Copy and voice](#copy-and-voice), `GLOSSARY.md` and the `unslop` skill.
3. **Wire the blog post.** Once delegates finish:
   - Register each new demo screen in `apps/linky-site/src/landing/copy.ts` and `apps/linky-site/src/landing/demo/screens.tsx`.
   - Create the blog files (`vite.config.ts` and `src/blog/articles.ts` auto-discover them by folder name):
     - `apps/linky-site/blog/linky-<slug>/index.html` (title, description, `og:image` set to `/blog/linky-<slug>/cover.jpg`, 1280x720)
     - `apps/linky-site/src/blog/articles/linky-<slug>/index.ts`
     - `apps/linky-site/src/blog/articles/linky-<slug>/media.ts`
     - `apps/linky-site/src/blog/articles/linky-<slug>/en.tsx` and `cs.tsx` (plus `sk.tsx` only when relevant or requested), mounting demos with `<DemoFigure>` inside `<FigureRow>`
4. **Capture videos and blog cover.** Start `apps/linky-site` locally (`cd apps/linky-site && bunx vite --port <port> --strictPort`), capture 4:5 dark-mode demo videos and composite the 1280x720 `cover.jpg` as in [Video and cover capture](#video-and-cover-capture). Copy `cover.jpg` to `apps/linky-site/public/blog/linky-<slug>/cover.jpg` and to `<site-dir>/videos/cover.jpg`. Before encoding or deploying, inspect `cover.jpg` and captured frames from every scene of every demo against the current `apps/linky-app` UI so opening, intermediate and final scenes all match the shipped screens.
5. **Build and deploy the social posts page.** Write the standalone editable `index.html` and `vercel.json` in `<site-dir>` and deploy to `https://linky-<compact>.twoballers.dev/` as in [Social posts page and Vercel deploy](#social-posts-page-and-vercel-deploy). Confirm HTTP 200 on `/` and every video and cover URL.
6. **Verify and open the blog PR.** Run all four checks in order and fix anything that fails:
   - `bun run check-changed`
   - `bun run test-changed`
   - `bun run site:build`
   - `bun run e2e site` followed by `bun run e2e down`

   Push `docs/blog-linky-<slug>` and open a ready-for-review PR with `pull_request_create`, following `.agents/skills/file-linky-pr/SKILL.md` and `CONTRIBUTING.md`. Embed the live cover image (`https://linky-<compact>.twoballers.dev/videos/cover.jpg`) in the PR body and credit the models used.

## Copy and voice

Every piece of blog and social copy must follow these rules:

- **Audience.** Regular non-developer users. Talk about product, UI and UX impact instead of internal library upgrades. Skip internal bumps (such as Evolu versions) and describe only practical effects, for example steadier multi-device sync and the need to update all devices.
- **Tone.** Natural, concise and direct. Follow `unslop` and `GLOSSARY.md`.
- **Terminology.**
  - Use **Cashu** or **Cashu tokens** in user-facing copy, never `ecash`.
  - In Czech and Slovak on-chain copy, use **platba** (for example `když platba dorazí na on-chain`), never `výplata`.
- **X (Twitter) format.** Match `@LinkyFit`'s single-post shape:
  - Opening line: `Linky <version> is out 🚀` (Czech: `Vyšel Linky <version> 🚀`)
  - 3 to 4 short emoji-led highlight lines
  - Blog link: `https://linky.fit/blog/linky-<slug>/`
  - Strict limit: `<= 280` X-weighted characters (every URL counts 23, emojis and CJK count 2, standard Latin counts 1).
  - Add at most one optional short reply, and only when needed for a second video or an extra note.
- **Languages.**
  - Social posts page: English and Czech only (`X (EN)`, `X (CS)`, `Nostr (EN + CS)`, `Signal (CS)`). Add Slovak only when the user asks for it.
  - Blog post: English (`en.tsx`) and Czech (`cs.tsx`), plus Slovak (`sk.tsx`) only when relevant to the release or requested.

## Video and cover capture

Record each demo directly from the local `apps/linky-site` blog page (`/blog/linky-<slug>/`) using Playwright so videos match the live `@linky-fit/ui` components pixel for pixel.

- **Viewport and theme.** `540x675` at `deviceScaleFactor: 2` (`1080x1350`, 4:5), `colorScheme: "dark"`, `reducedMotion: "no-preference"`, `locale: "en"`, with `localStorage` seeded to `linky.color_mode = "dark"` and `linky.lang = "en"`.
- **Deterministic frame stepping.**
  - Before `page.goto`, replace `window.IntersectionObserver` with a stub that stores observers so the capture script starts only the target `figure` on demand.
  - Wait for `document.fonts.ready` and image `.decode()`.
  - Inject CSS that hides everything except `figure.capture`, centers the phone frame (`width: ~262px`, `border-radius: 30px`, inner `26px`), hides `figcaption`, and sets `cursor: none`.
  - Install and pause Playwright's virtual clock (`page.clock.install`, `page.clock.pauseAt`), fire the stubbed `IntersectionObserver` callback for the target `figure`, then step 30 fps frames with `page.clock.runFor(delta)`.
  - After each step, flush React with a `MessageChannel` tick, then pause and seek every Web Animation under `figure.capture` (`getAnimations({ subtree: true })`) to `Math.max(0, t - startTrigger)`, where `startTrigger` is the latest cue timestamp `<= t` from `<name>Cues.ts`.
  - Capture each frame with `page.screenshot({ path, animations: "allow" })`.
  - Inspect a captured frame from every scene against the current `apps/linky-app` UI before encoding.
- **Encode with `ffmpeg`.**
  ```sh
  ffmpeg -y -loglevel error -framerate 30 -i "<frames>/%04d.png" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart -an \
    "<out>/<name>.mp4"
  ```
  Verify dimensions (`1080x1350`), frame rate (`30/1`), `yuv420p`, duration and size with `ffprobe`.
- **Blog cover (`1280x720`).** Open the same blog page in a `1280x720` dark viewport (`deviceScaleFactor: 2`), position the demo phones side by side over a subtle teal radial glow on `rgb(2, 6, 23)`, advance the virtual clock past the final cue and seek all animations to completion so every phone sits in its settled end state, capture PNG, and convert/resize to `1280x720` `cover.jpg`.

## Social posts page and Vercel deploy

Build a single self-contained `index.html` in `<site-dir>` with no external assets beyond `videos/*.mp4` and `videos/cover.jpg`:

- Include `<meta name="robots" content="noindex">` and `<meta name="color-scheme" content="light dark">`.
- Render video players with download links plus a download link for `videos/cover.jpg`.
- Render sections for `X (EN)`, `X (CS)`, `Nostr` (EN + CS) and `Signal (CS)`.
- Make every `.post` block `contentEditable = "plaintext-only"` with `spellcheck = true`, persisted in `localStorage` under `linky-<compact>-post:<card-label>`, with Copy and Reset buttons and an `edited` indicator.
- Show a live `N / 280` X-weighted character counter on X cards (URLs = 23, characters outside Latin light ranges = 2 after stripping `\uFE0F` and `\u200D`, light Latin = 1) that highlights over-limit counts.

Add `vercel.json` in `<site-dir>`:

```json
{
  "framework": null,
  "buildCommand": "",
  "installCommand": "",
  "outputDirectory": "."
}
```

Deploy with `CI=1` so the Vercel CLI never blocks on an upgrade prompt:

```sh
cd "<site-dir>"
CI=1 vercel link --yes --project "linky-<compact>" --scope david-novaks-projects-ffea9efe
CI=1 vercel deploy --prod --yes --scope david-novaks-projects-ffea9efe
CI=1 vercel domains add "linky-<compact>.twoballers.dev" "linky-<compact>" --scope david-novaks-projects-ffea9efe
```

Finish by curling `https://linky-<compact>.twoballers.dev/`, `videos/cover.jpg` and every `videos/*.mp4` and confirming HTTP 200 on each.
