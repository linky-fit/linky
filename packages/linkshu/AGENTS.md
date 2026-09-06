# @linky/linkshu

Usage guides for this package live in `docs/` (index: `docs/README.md`). Read the guide for a vertical before changing it; the guide states the persistence order and error contract callers rely on.

## Keep the docs in sync

Changing the public surface — anything exported from `src/index.ts` (drafts, receipts, service methods, errors, ports, config) or the behavior a guide describes — is done only when the matching `docs/*.md` file is updated in the same commit. Done means: every snippet in the touched guide still typechecks against the new surface, every table row still names a real field or error tag, and a new vertical or port has its own guide linked from `docs/README.md`.
