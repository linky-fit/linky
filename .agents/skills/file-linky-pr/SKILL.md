---
name: file-linky-pr
description: Always use when opening PR or when user asks you to file/open a PR.
---

## Scope
Understand the scope. The change should be targeted to one thing. It's ok to include small fixes in the same PR, but if so, commit them separately. If you see user doing a lot of unrelated changes. Recommend user to split the PR. 

## Test before pushing
Run package tests, and lint commands.
If the change affects what a user sees or does, run the app against local dev and try the affected flow at phone width. Use that run to gather screenshots (see below). Changes with no visible effect (packages, config, docs) don't need a local-dev run.

## Add screenshot for UI changes
For a UI change, add before and after screenshots to the PR description, or a short screen recording if motion or timing matters. Skip this for changes with no visible effect.

## PR description, names and commit messages
For titles prefer a concise, human-readable title that explains **why the change matters**

BAD:
> ❌ perf(server): negotiate permessage-deflate on the websocket

GOD:
> ✅ perf(server): cut websocket frame size by 70%+ with gzipping

When writing a commit message, keep in mind, humans will read it. Be clear and to the point. Explan the intention and why the change should exist.

## Contributing file

Look into CONTRIBUTING.md and make sure the PR follows the guidelines.
