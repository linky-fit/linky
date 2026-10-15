# @linky-fit/web-app

- First render uses local state; network catch-up waits for `useDeferredOnlineReady`.
- Compose screens from `@linky-fit/ui` components, icons and tokens; `linky-ui/ui-only` rejects DOM elements, `className` and `style`.
- `index.css` is the only stylesheet: platform rules Tamagui props cannot express (font, viewport, safe-area and keyboard CSS variables).
