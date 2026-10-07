# 🎯 SPOTTER // ONE SHOT

A **voice-controlled sniper game** built for the Fish Audio hackathon.

You lie in the grass with a pair of binoculars. Beside you, **Ghost**, an AI sniper, waits
behind the rifle. He only shoots what you tell him to. Find the target through your
binoculars, read the weather, and **talk him onto the shot**.

## ▶️ Play

**Online (GitHub Pages):** open the repo's Pages URL, e.g. `https://b-i-king.github.io/hitman-sniper-game/`,
in **Chrome or Edge**, click **MIC** and allow the microphone. The game runs entirely in the
browser: speech recognition and the voices of Ghost and the target use the browser's own
speech engine, so no server or API key is needed.

**Locally, with Fish Audio voices:**

```bash
cp .env.example .env   # add FISH_API_KEY
npm start              # Node 20+, no install needed → http://localhost:3000
```

Press **Enter** on the menu to start **Survival**, the main mode. New players can try **Training 1** first.

## 🎮 How to play

1. **Turn on your mic.** Click **MIC** (or press `M`) and allow access. Use Chrome or Edge. Headphones help. No mic? Type the same words into the box at the bottom.
2. **Start Survival** (press Enter on the menu) or pick a Training drill. **Read the briefing.** It tells you who the target is (suit, tie, glasses, hat) and what the weather is doing. Say *"start mission"*.
3. **Look through your binoculars.** Drag the view or use the arrow keys to scan, and scroll to zoom. Every person has a number tag. Press `B` (or say *"binoculars down"*) to lower them and see Ghost lying prone beside you.
4. **Name the target.** Say *"Target three."* Ghost replies with what he sees through his scope (*"Black suit, blue tie"*). If that isn't your man, pick again.
5. **Call the conditions** shown on the right:
   - **Range**: *"Range six hundred."* In **fog or heat haze** the laser gets no return, so measure on the binocular scale instead: range = 1.75 m × 1000 ÷ the person's height in mils.
   - **Wind**: *"Wind eight from the right."* It gusts. Watch the meter and the orange flags. Ghost tells you when it shifts.
   - **Temperature**: *"Temperature fifteen."* Cold air means more drop, hot air means less.
   - **Movement**: *"Moving at one."* Ghost aims ahead of him. Or wait until he stops (Ghost calls it out).
6. **Go for the head**: *"Go for the head."* A body shot might not kill him.
7. **Give the order**: *"Send it!"* On the train, say *"Fire when ready"* and Ghost shoots when the window is clear.
8. **If he survives, follow up.** A miss or a wound sends him running and the civilians scatter. You have about 8 seconds for one more shot: *"Moving at three, send it!"*

You can say the whole call in one breath: *"Target two, range four fifty, wind six from the right, go for the head, send it."*

### Scoring (0 to 100)

| Hit | Score | What happens |
|---|---|---|
| Headshot | **100** | Always kills |
| Neck / center mass | 85 to 100 | Usually kills. Off-center chest hits can fail |
| Gut | 70 | 50/50 he survives and runs |
| Arm / leg | 45 / 30 | He runs |
| Wounded and escaped | max 50 | You get one follow-up shot first |
| Follow-up kill | 80% of that shot | |
| Miss / out of time | 0 | |
| Civilian | **0** | **Mission failed** |

70 or more passes. The hint (`H`) caps the score at 60.

## The three roles

| Role | Who | What they do |
|---|---|---|
| 🔭 **Spotter** | You (voice + binoculars) | Scan with the binoculars, identify the target, read conditions, give the call, order the shot |
| 🎯 **Ghost, the sniper** | AI agent beside you | Dials the firing solution from your call, describes who he's on, warns of wind shifts and target movement, fires on command. Voiced with Fish Audio TTS |
| 🕴️ **The Target** | A new mark each contract | Walks, stops, rides trains, taunts you over intercepted radio (a second Fish voice), and runs if he survives |

## Modes

### Survival (main mode)

Endless contracts, each a random variation of the five Training drills. Each contract rolls a
new target (name, suit, tie, glasses, hat), range, wind, gusts, temperature, weather (clear,
rain, snow, fog, heat haze), crowd size, walking patterns, train speed and time limit. The
difficulty climbs with every contract. Fail one (score under 70 or a civilian hit) and you
lose a life, then **retry the same contract** (the default: press Enter or say *"retry"*).
Say *"new contract"* to roll a different one at the same difficulty instead. You have 3 lives.
Your best score is saved in your browser.

### Training: 5 drills (easy → hard)

| # | Drill | Range | Weather | Skill it teaches |
|---|---|---|---|---|
| 1 | Open Field | 300 m | Clear | Target stands still, alone in the middle of the field. Learn the basics |
| 2 | The Farmhouse | 450 m | Clear, windy | 2 civilians next to the target, steady crosswind |
| 3 | Winter Market | 600 m | Snow, 15°F | Cold air adds drop, gusty wind, a walking target and a decoy in a similar suit |
| 4 | Rooftop Rendezvous | 800 m | Heat haze, 95°F | Laser blocked, so you measure the range yourself. Strong gusts |
| 5 | The Midnight Express | 450 m | Night rain | Target on a **constantly moving train**, seen through night vision. Lead him and fire through the window |

### Weather and the elements

| Condition | Effect |
|---|---|
| Wind (with gusts) | Pushes the bullet sideways. The meter and flags change over time |
| Temperature | Cold = denser air = more drop. Hot = less drop |
| Fog | Laser rangefinder can't get a reading, and visibility is reduced |
| Heat haze | Laser can't get a reading, and the image shimmers |
| Rain | Blurs the view |
| Snow | Usually comes with freezing temperatures |
| Night | Binoculars and scope switch to night vision |

## The physics (what your call has to cover)

The sniper only knows what you tell him. If you don't call the range, he holds for his 100 m zero.

- **Range → bullet drop.** Velocity decays with drag, and gravity acts over the time of flight.
- **Temperature → air density.** Cold, dense air adds drag and drop. Hot air reduces it. The sniper assumes 59°F unless you call it.
- **Wind → drift.** Uses the lag-time formula: drift = crosswind × (time of flight − range / muzzle velocity). Wind gusts, so read the meter right before you call it.
- **Moving targets → lead.** Lead = speed × time of flight. The sniper leads in the direction the target is moving.

The debrief compares what you called with the real values and tells you what to fix.

## What to say

| Say | Effect |
|---|---|
| "Target three" | Designate the person with number tag 3 |
| "Range six hundred" | Range in meters |
| "Wind eight from the right" / "wind 8 right to left" | Crosswind (mph) and the side it comes from |
| "Temperature fifteen" | Air temperature (°F) |
| "Moving at four" / "stationary" | Target speed in m/s (lead) |
| "Go for the head" / "center mass" | Aim point |
| "Up 0.5", "left 1" | Manual corrections in mils |
| "Send it" / "Fire" / "Take the shot" | Fire now |
| "Fire when ready" | Sniper fires as soon as the target is clear (best for the train) |
| "Hold fire", "Status", "Reset", "Zoom in/out" | Cancel, read back the solution, clear corrections, change the view |
| "Start mission", "Retry", "Next mission" | Menu navigation |

You can say it all in one breath: *"Target two, range four fifty, wind six from the right, send it."*
Numbers work spoken ("six fifty", "one point five", "minus five") or as digits.

| "Retry" / "New contract" | After a failed Survival contract: same contract again (default) or a different one |
| "Pause" / "Resume" | Freeze the clock |
| "Binoculars down" / "binoculars up" | Look with the naked eye (Ghost beside you) or through the binoculars |

Keyboard: `M` mic on/off · `B` binoculars · arrows or drag to look · scroll or `Z` zoom · `C` re-center · `F` fire · `P` pause · `H` hint · `T` type a command · `Space` push-to-talk (Fish mode) · `Esc` menu.

## Host it on GitHub Pages

The game is static: `public/` is the whole site, and `server.mjs` is only needed for Fish Audio.

1. In the repo on GitHub, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow from the **Actions** tab.
   The workflow (`.github/workflows/pages.yml`) runs the tests, then publishes `public/`.
4. The URL appears in the workflow run and under Settings → Pages:
   `https://<user>.github.io/<repo>/`.

Pages serves over HTTPS, which browsers require before they allow the microphone. On Pages
the game uses browser speech recognition and browser voices. The Fish Audio voices, Fish
speech-to-text and the LLM interpreter need the server, because the API key must never be in
the page.

## Run it locally

Requires **Node.js 20+**. No `npm install` needed: the server has zero dependencies.

```bash
cp .env.example .env    # optional: add FISH_API_KEY for Fish Audio voices
npm start               # → http://localhost:3000
```

Open it in **Chrome or Edge**, click the mic, and allow microphone access. Headphones are recommended.
Without headphones the game ignores the mic while the sniper is talking, so it doesn't hear itself.

### Voice stack

| Piece | With `FISH_API_KEY` | Without keys |
|---|---|---|
| Sniper and target voices | Fish Audio TTS (`/v1/tts`), two voices (`FISH_SNIPER_VOICE_ID`, `FISH_TARGET_VOICE_ID`) | Browser `speechSynthesis` |
| Spotter speech-to-text | Choose "Fish Audio STT" in the menu and hold Space to talk (`/v1/asr`) | Browser speech recognition, always listening, lowest latency |
| Command understanding | Built-in parser (instant). Optional LLM fallback for free-form sentences (`LLM_API_KEY`, any OpenAI-compatible endpoint) | Built-in parser |

The Fish API key stays on the server (`server.mjs`), and the browser never sees it. This follows
the pattern from the [fish-hackathon starter kit](https://github.com/cartorgaOrg/fish-hackathon).

## Project layout

```
server.mjs            static server + /api/tts, /api/stt (Fish Audio), /api/sniper (LLM), /api/config
public/index.html     UI shell
public/js/
  main.js             game loop, state machine, HUD, debrief
  levels.js           the five Training drills (Survival builds variations of these)
  endless.js          Survival contract generator (seeded variations of the drills)
  world.js            people, train, wind over time, hit testing, 0-100 scoring
  ballistics.js       drop / drift / time of flight / firing solution
  sniper.js           the AI sniper: applies spotter calls, tracks, computes impacts
  commands.js         speech → commands parser (numbers, homophones, phrasing variants)
  voice.js            browser speech recognition + Fish push-to-talk recorder
  audio.js            synthesized SFX + Fish/browser character voices
  render.js           canvas renderer: binocular view, naked-eye view with Ghost, weather, rifle-scope inset
test/                 node:test suites (npm test)
```

## Tests

```bash
npm test
```

The tests check that a perfect call eliminates the target on every mission, that a skipped
range call misses, that every generated Survival contract is winnable, the direction of the ballistics effects, civilian casualties, train
occlusion, and the speech parser on real-world phrasings.

## Adding a mission

Add an entry to `LEVELS` in `public/js/levels.js`: distance, temperature, wind
`{ base, gust }`, people (with an optional `move` walk pattern or a `car`/`window` seat on a
train), and scenery props. The tests automatically check that the new mission can be won.
