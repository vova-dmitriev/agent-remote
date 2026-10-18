# README screenshots

These images show existing synthetic Storybook stories in English with the dark theme. They contain checked-in demo IDs, models and messages, not real sessions. The session list illustrates available source types; it does not verify that each integration works against a live application.

| File               | Story                                   | CSS viewport | PNG size    |
| ------------------ | --------------------------------------- | ------------ | ----------- |
| `sessions.png`     | `app-remote-application--sessions`      | 1100 × 760   | 2200 × 1520 |
| `accounts.png`     | `pages-accounts--accounts-and-keys`     | 700 × 1000   | 1400 × 2000 |
| `conversation.png` | `app-remote-application--codex-session` | 430 × 600    | 860 × 1200  |

The accounts image uses `apps/mini-app/.storybook/fixtures/accounts/profiles.ts` and `apps/mini-app/src/pages/accounts/ui/accounts-view.stories.tsx`. Its identities are reserved synthetic examples; it does not prove authenticated provider compatibility.

## Source fixtures

- `apps/mini-app/src/app/remote-application.stories.tsx`
- `apps/mini-app/.storybook/components/application-story.tsx`
- `apps/mini-app/.storybook/components/sessions-page-story.tsx`
- `apps/mini-app/.storybook/components/session-page-story.tsx`
- `apps/mini-app/.storybook/fixtures/session.ts`
- `apps/mini-app/.storybook/fixtures/page-states.ts`

The screenshots preserve the fixture content without DOM replacements or image retouching. All images were visually inspected; the capture script also rejects Cyrillic page text.

## Reproduce

Use an isolated Storybook server. From the repository root, start it in one terminal:

```sh
cd apps/mini-app
npm run prepare:storybook
./node_modules/.bin/storybook dev --port 6007 --ci --no-open
```

From the repository root in another terminal:

```sh
node docs/screenshots/capture.mjs
```

The script uses the installed Chrome channel through Playwright, creates a fresh browser context for each image, selects `language:en;theme:dark` and captures at device scale factor 2. It allows only the selected local Storybook origin and the reserved MSW fixture origin `http://api.storybook.local`. It does not open the production app, authenticate, submit prompts or access real session APIs.

Story URLs:

- [Sessions](http://localhost:6007/iframe.html?id=app-remote-application--sessions&viewMode=story&globals=language%3Aen%3Btheme%3Adark)
- [Codex conversation](http://localhost:6007/iframe.html?id=app-remote-application--codex-session&viewMode=story&globals=language%3Aen%3Btheme%3Adark)

To use an already running isolated Storybook on port 6006, set `STORYBOOK_URL=http://localhost:6006` when running the script. No other ports are accepted.
