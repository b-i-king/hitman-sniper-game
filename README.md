# 🎯 SPOTTER // ONE SHOT

A **voice-controlled sniper game** built for the Fish Audio hackathon.

**You are the spotter.** An AI sniper lies next to you and does exactly what you tell him. Find
the right target in the crowd, read the range, wind and temperature, then talk him onto the shot.
Each shot is graded **0 to 100**:

| Hit | Score |
|---|---|
| Headshot | **100** |
| Neck / center mass | 85 to 100 (closer to the heart scores higher) |
| Gut | 70 (target down) |
| Arm | 45 (target wounded and escapes) |
| Leg | 30 (target wounded and escapes) |
| Miss / out of time | 0 |
| Civilian | **0, CIVILIAN CASUALTY** |

70 or more passes the mission. Using the hint caps the score at 60.

## The three roles

| Role | Who | What they do |
|---|---|---|
| 🎧 **Spotter** | You (voice) | Identify the target, read conditions, give the call, order the shot |
| 🎯 **Sniper** | AI agent | Dials the firing solution from your call, tracks the target, reads back, fires on command. Voiced with Fish Audio TTS |
| 🕴️ **Target** | Viktor "The Viper" Kovac | Walks, stops, rides trains, and taunts you over intercepted radio (a second Fish voice). Runs if you miss |

## Missions (easy → hard)

| # | Mission | Range | Challenge |
|---|---|---|---|
| 1 | Open Field | 300 m | Stationary target alone in the middle of the field. Calm. Learn the basics |
| 2 | The Farmhouse | 450 m | 2 civilians next to the target, steady crosswind |
| 3 | Winter Market | 600 m | 15°F (cold air = more drop), gusty wind, a walking target, and a decoy in a similar suit |
| 4 | Rooftop Rendezvous | 800 m | Rangefinder **offline**: estimate range with the mil grid. 95°F heat, strong gusts |
| 5 | The Midnight Express | 450 m | Target on a **constantly moving train**. Lead him and fire through the window |

Every mission has a time limit.

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

Keyboard: `M` mic on/off · `Space` push-to-talk (Fish mode) · `F` fire · `H` hint · `Z` zoom · `T` type a command · `Esc` menu.

## Run it

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
  levels.js           mission definitions (add your own here)
  world.js            people, train, wind over time, hit testing, 0-100 scoring
  ballistics.js       drop / drift / time of flight / firing solution
  sniper.js           the AI sniper: applies spotter calls, tracks, computes impacts
  commands.js         speech → commands parser (numbers, homophones, phrasing variants)
  voice.js            browser speech recognition + Fish push-to-talk recorder
  audio.js            synthesized SFX + Fish/browser character voices
  render.js           canvas renderer: spotter scope, mil grid, sniper scope inset
test/                 node:test suites (npm test)
```

## Tests

```bash
npm test
```

The tests check that a perfect call eliminates the target on every mission, that a skipped
range call misses, the direction of the ballistics effects, civilian casualties, train
occlusion, and the speech parser on real-world phrasings.

## Adding a mission

Add an entry to `LEVELS` in `public/js/levels.js`: distance, temperature, wind
`{ base, gust }`, people (with an optional `move` walk pattern or a `car`/`window` seat on a
train), and scenery props. The tests automatically check that the new mission can be won.
