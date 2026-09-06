# @linky/linkstr

Usage guides for this package and for `@linky/linkstr-react` live in `docs/` (index: `docs/README.md`). Read the guide for a vertical before changing it; the guide states the wire kinds, delivery contract, and inbound event shapes callers rely on.

## Keep the docs in sync

Changing the public surface — anything exported from `src/index.ts` or `src/testing/index.ts` (drafts, receipts, inbound events, service methods, errors, config), or from `../linkstr-react/src/index.ts` (atoms, testing helpers) — or the behavior a guide describes, is done only when the matching `docs/*.md` file is updated in the same commit. Done means: every snippet in the touched guide still typechecks against the new surface, every table row still names a real field, event tag, or error tag, and a new vertical follows `docs/adding-a-vertical.md` and gets its own guide linked from `docs/README.md`.
