---
name: file-a-pr
description: Use when user asks you to fire a PR
---

## Scope
Understand the scope. The change should be targeted to one thing. It's ok to include small fixes in the same PR, but if so, commit them separately. If you see user doing a lot of unrelated changes. Recommend user to split the PR. 

## Test before pushing
Run package tests, and lint commands. 
Unless explicitly stated otherwise (or the change is extremely straight forward), test the app against local dev. Focus on areas of the app that are affected by the change. Use the test to gather screenshots (see below).

## Add screenshot for UI changes
For anything resembling PR change, get screenshot or do a screen recording and add it to PR description. 

## PR description, names and commit messages
For titles prefer a concise, human-readable title that explains **why the change matters**

BAD:
> ❌ perf(server): negotiate permessage-deflate on the websocket

GOD:
> ✅ perf(server): cut websocket frame size by 70%+ with gzipping

When writing a commit message, keep in mind, humans will read it. Be clear and to the point. Explan the intention and why the change should exist.

## Contributing file

Look into CONTRIBUTING.md and make sure the PR follows the guidelines.
