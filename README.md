# A F-cking Trivia Game

A F-cking Trivia Game is a real-time, two-player-friendly trivia brawler built with React, Vite, Supabase, and Gemini. It mixes a game-show wheel, Supabase-backed questions, live sync, lobby chat, audio cues, and sarcastic roast copy into something that feels closer to a chaotic couch competition than a polite quiz app.

## What this thing does

- **Solo mode** for practicing against the game without waiting on another human.
- **Multiplayer mode** with a 4-digit join code and shared live game state.
- **Turn-based category wheel** so each round feels unpredictable.
- **Win condition based on category coverage**: answer one question from each non-random category before your opponent does.
- **Supabase-backed trivia and AI-generated heckles** so gameplay stays database-driven without losing the app’s tone.
- **PWA install support** with a service worker, manifest, install prompt, and standalone display mode.
- **Lobby chat + match history** for a little more trash talk and continuity.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Motion
- **State + realtime sync:** Supabase Auth + database/realtime services
- **Content generation:** Gemini (`@google/genai`) for heckles
- **PWA bits:** `manifest.webmanifest`, `sw.js`, custom install prompt
- **Media:** local audio assets for theme, spin, win/loss, and answer feedback

## Core gameplay loop

1. Sign in with Google.
2. Choose an avatar.
3. Start a solo match or create/join a multiplayer game with a 4-digit code.
4. Spin the wheel.
5. Answer the question.
6. If you are right, your score and streak go up and that category is marked complete.
7. If you are wrong, your turn ends in multiplayer and the game roasts you for your choices.
8. First player to complete every non-random category wins.

## Project structure

```text
.
├── public/
│   ├── manifest.webmanifest   # PWA name, icons, theme colors
│   ├── sw.js                  # service worker entry point
│   ├── *.mp3                  # audio assets
│   └── icon-*.png             # install/app icons
├── src/
│   ├── components/            # lobby, wheel, cards, prompts, overlays
│   ├── services/gemini.ts     # heckle generation client
│   ├── types.ts               # shared game data contracts
│   ├── App.tsx                # main gameplay + realtime orchestration
│   └── main.tsx               # React entry and service worker registration
├── metadata.json
└── README.md
```

## Local development

### Prerequisites

- Node.js 20+ recommended
- npm
- A Supabase project configured for auth/database access
- A Gemini API key for heckle generation

### Installation

```bash
npm install
```

### Environment variables

Create a local env file such as `.env.local` with:

```bash
GEMINI_API_KEY=your_gemini_api_key
```

### Supabase configuration

This repo expects Supabase environment variables for the active app. Make sure your local env points at the correct project before running locally.

### Start the app

```bash
npm run dev
```

Vite serves the app on port `3000` by default.

## Build and validation

### Type-check

```bash
npm run lint
```

### Production build

```bash
npm run build
```

## How realtime multiplayer works

The app stores each active match in Supabase and listens to the backing rows in real time.

That means both players stay synced without a custom game server, which is great for speed but also means your Supabase schema and policies matter a lot.

## Question sourcing

Gameplay questions are loaded from Supabase.

- The client reads approved questions from the database during game setup and round progression.
- This app no longer ships a frontend or API route for generating question batches.
- If you need to add questions, seed or manage them through Supabase-admin workflows instead of the game client.

## PWA behavior

This project is installable as a Progressive Web App.

- `public/manifest.webmanifest` defines the install name, icons, colors, and standalone mode.
- `src/main.tsx` registers `public/sw.js` after page load.
- `src/components/InstallPrompt.tsx` shows a custom install CTA when `beforeinstallprompt` fires.

If you change the manifest name, icon, or branding and do **not** see the update after reinstalling, clear the installed app and browser site data first. Browsers aggressively cache manifest metadata.

## Current product strengths

After reviewing the app, these are the strongest parts of the current experience:

- **Strong personality:** the tone is clear immediately and the UI commits to it.
- **Good match readability:** wheel, score cards, active-player highlighting, and game-over state are easy to parse.
- **Low-friction multiplayer:** short code join flow is the right call for casual head-to-head play.
- **Question control:** keeping the bank in Supabase makes content provenance and approval state easier to reason about.
- **Installability:** the app already behaves like something people could save to a home screen and replay.

## Known rough edges worth keeping an eye on

These are not necessarily bugs, but they are the places where the current build will probably feel sharpest to users:

- Question fetching, game creation, and replay setup are all async and can feel opaque if Supabase is slow.
- Multiplayer is best at exactly two players right now; the UX and data model are tuned for that.
- There is no explicit rematch countdown, turn timer, or reconnect recovery messaging yet.

## Suggested UX roadmap for two-player matches

If you want the biggest payoff for head-to-head play, start here:

### 1. Make turns feel snappier
- Add a short turn timer with escalating visual urgency.
- Auto-pass to the next player after timeout.
- Show a clearer transition state like “Sam blew it. Jamie is up.”

### 2. Reduce lobby awkwardness
- Show presence indicators such as “connected”, “typing”, and “ready”.
- Let both players explicitly tap **Ready** before the host starts.
- Surface invite sharing actions for the 4-digit code.

### 3. Improve competitive drama
- Add a shared scoreboard strip with streak, categories left, and current leader.
- Celebrate steals, comebacks, and match point moments.
- Add a round recap after each question with the correct answer and category progress delta.

### 4. Strengthen fairness and trust
- Show whose turn it is in multiple places, not just one.
- Add lightweight reconnect/resume messaging when a player refreshes or drops.
- Preserve more match context so accidental quits feel less punishing.

### 5. Make post-game replay irresistible
- Give both players a stat screen: accuracy, hottest streak, hardest category, best roast survived.
- Offer instant rematch with the same players.
- Rotate match modifiers for replay value, like “revenge round” or “all random once”.

## Troubleshooting

### Install name or icon did not update

Browsers cache PWA metadata aggressively. Try this in order:

1. Uninstall the app from the device/home screen.
2. Clear site data for the domain.
3. Reload the page in the browser.
4. Reinstall the PWA.

### Google sign-in popup fails

- Make sure Google is enabled under Supabase Auth providers.
- Confirm the current domain is allowed in your Supabase URL and redirect settings.
- Check the browser is not blocking popups.

### Questions do not load

- Confirm the Supabase client variables are set.
- Check that the question rows exist in Supabase and have the expected approval status.
- Check browser console output for Supabase errors.

## Short version

It is a loud, sarcastic, real-time trivia game for people who would rather talk shit than quietly fill out a quiz form. That is the product. Protect that energy while smoothing out the waiting, reconnect, and rematch flow.
