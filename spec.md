# Cube Pop — Game Design Document (running spec)

**Pitch:** Tap a cluster of matching toy cubes to pop it; pop five to forge a rocket, eight to forge a bomb, and set them off in chains to fill colour quotas on a cheerful 3D toy-studio wall.
**Genre:** Cluster-pop puzzle (single tap, gravity refill, colour quotas). **Players:** 1, with an asynchronous server-validated daily leaderboard. **Session:** 1–4 minutes per round; 40-stage journey, 6 challenges, 7 lessons, daily seed, endless score chase.
**Platforms:** Desktop and mobile browsers (Chrome, Safari, Firefox), portrait and landscape, keyboard, mouse, touch and gamepad.
**Rendering:** Three.js (`vendor/three.module.min.js`) draws an instanced wall of rounded cubes in a lit toy studio; every menu, HUD element and overlay is semantic HTML. A DOM mirror grid makes the board playable without WebGL.

| Path | Responsibility |
|---|---|
| `index.html` | Single page: title, nine list/settings screens, game screen, overlays, live regions, script order |
| `css/style.css` | Palette tokens, breakpoints (≥1024 / 600–1023 / <600 / landscape ≤500 h), safe areas, 44 px targets |
| `js/rng.js` | mulberry32 PRNG, FNV-1a `hashString`, three derived streams (rules / decor / AV) |
| `js/rules.js` | Pure deterministic rules engine: `createGame`, `applyCommand`, legality, scoring, hints, hashing, serialisation |
| `js/content.js` | Versioned content: 6 cube colours, 5 themes, 40 journey stages, 6 challenges, 3 practice presets, score-chase ruleset, daily generator, 7 lessons, 11 achievements |
| `js/session.js` | Round lifecycle over the engine: command ids, undo stack, replay envelope, stars, localStorage docs, server-time sync, daily submit/board |
| `js/audio.js` | WebAudio buses, authored Opus one-shots with synth fallbacks, ambience loop, seeded pentatonic music |
| `js/render.js` | `BoardRenderer`: studio environment, instanced cubes + charms, special meshes, particles, markers, camera, pointer input |
| `js/ui.js` | Screens, HUD, settings, board mirror, keyboard/gamepad, rounds, pause/results, persistence glue; `CPUI.init` |
| `js/main.js` | ES-module bootstrap: WebGL detection, renderer factory, `CPUI.init` |
| `server.js` | StarHermit game script: static hosting, `/api/v1/time`, daily board read, daily submit with full replay validation |
| `data/daily-boards.json` | Server-side ranked daily entries (never served) |
| `assets/` | `title-keyart.webp`, `results-banner.webp`, `table-wood.webp`, `toy-rocket.glb` |
| `sfx/` | 21 Opus clips, `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md` (generator output) |
| `tests/rules.test.js` | 37 engine/content unit, property, fuzz and golden tests (`npm test`) |
| `tests/e2e.mjs` | Playwright playthrough of the real UI at desktop and mobile viewports (`npm run test:e2e`) |
| `tests/browser-smoke.html` | Iframe smoke page for headless Chrome `--dump-dom` |
| `tools/smoke-server.js`, `tools/validate-content.js` | Dev-only: API round-trip test; offline content validator |
| `starhermit.txt`, `coverart.png`, `icon.png`, `favicon.svg`, `LICENSE.md` | Platform manifest, 1200×675 cover, 256 px icon, tab icon, PolyForm Noncommercial 1.0.0 |

## 1. Vision and design pillars

Cube Pop is the feeling of sweeping a shelf of toy blocks off a table with one finger: immediate, tactile and a little bit greedy. The whole design serves one question the player asks every second: *which cluster do I pop now?*

1. **Every tap pops something.** Minimum group is 2, `createGame` and every `applyCommand` call `guaranteeMove` so a legal action always exists, and a deadlocked wall reshuffles itself for free (`rules.js` `guaranteeMove`, event `shuffle`). Rules in: free reshuffles, loose quotas early on. Rules out: "no moves left" losses, boards you have to stare at.
2. **Big groups forge tools.** Specials are never given, only earned: a 5+ group leaves a rocket on the tapped cube, an 8+ group a bomb, and blasts detonate other specials into chains (`applyCommand`, `detonate`). Rules in: hunting for size, planning where the special lands. Rules out: boosters, purchased power-ups, random specials from refills.
3. **The wall is a toy, not a screen.** Rounded bevelled cubes with cream charms, a wooden table, a shelf of props, warm key light, plastic pops and marimba stings. Rules in: soft edges, matte plastic, wood, confetti. Rules out: neon, glass, glitch effects, abstract grids.
4. **One engine, everywhere.** Tutorial fixtures, hints, undo, the client and the leaderboard server all run the same `CPRules` on the same seeds; the daily board only ranks replays that re-simulate to the identical final hash (`server.js` `validateDaily`). Rules in: shareable seeds, replay envelopes, inspectable RNG. Rules out: hidden difficulty tuning, unverifiable scores.
5. **Playable without the picture.** The DOM mirror grid, live regions, captions and a keyboard focus ring are first-class; the 3D view is a lens on the same state. Rules in: labels on every cell, colour + icon + charm redundancy. Rules out: canvas-only controls, hover-only information.

## 2. Player experience

**Target player:** anyone who enjoys short colour-matching puzzles; no genre literacy assumed. Rounds fit a commute stop; the journey rewards returning for 20-30 sessions.

**First 60 seconds (as implemented):** the title shows the key art and a dominant `Play: First Pops` button (`refreshTitle` names the next uncompleted stage). One click starts journey stage 1 — a 6×6, 4-colour wall with two 10-cube quotas, no limits and no specials — after a 3-2-1-Pop! countdown. The stage card's `intro` text ("Tap any group of 2+ matching cubes…") is announced on activation; hovering or focusing a cell lifts and outlines its whole group, so the first legal move is visible before it is taken. Invalid taps buzz and toast the reason. Stages 3, 4, 6, 7, 9, 15 and 16 each introduce exactly one new idea in their `intro` line (rockets, move limit, bombs, chains, fifth colour, time limit, sixth colour). The **Learn** screen holds seven fixture-grid lessons that each require the player to perform the rule (`Content.tutorialLessons`, `Session.lessonGoalMet`).

**Session shape:** pick a card → countdown → 8-25 taps → results card with a score breakdown, stars and a Next button → next stage or menu. Pausing saves the round; the title shows `Resume saved round` on return.

**Emotional beat:** the swell from "small pops" to "I built a bomb next to two rockets" and the chain that follows: screen shake, three blasts in a row, `chain-surge` chimes and a goal rail that fills in one move.

## 3. Core loop and rules contract (`js/rules.js`)

### Board and entities
- Grid `rows × cols` (6×6, 7×7 or 8×8 in shipped content; engine accepts any). Row 0 is the top. Each cell is `{c: colourIndex, s: special}` or `null` (transient, during resolution).
- Specials: `S_ROCKET_H=1` (row), `S_ROCKET_V=2` (column), `S_BOMB=3` (3×3). A special keeps its colour for goal counting.
- Colours are indices into `Content.COLORS`: 0 Cherry ♥, 1 Lemon ★, 2 Leaf ▲, 3 Sky ◆, 4 Grape ☾, 5 Tangerine ✿.
- Config fields: `seed, board, colors, goals{colour:count}, minGroup (2), rocketAt, bombAt (99 = off), moveLimit, timeLimitSec, par{moves,timeSec}, mechanics{undo,hint}, endless{moveBank,movesPerWave}|null, theme`.

### Commands and legality
- `pop {r,c,id?,atMs?}`: legal if the cell holds a special (always) or belongs to a 4-way connected same-colour group of ≥ `minGroup` (`groupAt`, `checkPop`). Specials never join groups. Rejections: `game-ended`, `bad-location`, `empty-cell`, `group-too-small`, `malformed-command`, `unknown-command`.
- `tick {atMs}`: advances the quantised clock (100 ms steps) so a time limit can expire without a pop.
- `resign`: ends the round as a loss (`resigned`). The UI never sends it; it exists for hosted play.
- `validateCommandShape` bounds every field (payload ≤ 512 chars, ids ≤ 64 chars, coordinates in −1..99) at the session and server boundaries. Duplicate command ids are rejected idempotently (`Session.command`, `validateDaily`).

### Resolution order (one `applyCommand`)
1. Clone state, `tick++`, `moves++`, quantise `elapsedMs`.
2. **Special tapped:** `detonate` collects its blast (`blastCells`), recursively firing any special it touches (each extra one increments `chain`). **Group tapped:** all members clear except, when `n ≥ rocketAt`/`bombAt`, the tapped cube which becomes the special. Rocket orientation: taller-than-wide silhouette → column rocket, otherwise row rocket.
3. Goals: every cleared cube of a quota colour increments `state.goals[colour]`.
4. Gravity compacts each column downward (`fall` event), then refills empty cells from the top with `rng.int(colors)` (`refill` event) from the rules stream, whose state is stored in `rngState`.
5. Terminal check, in order: goals complete → `win` (or a new **wave** in endless); then `moveLimit`/move bank exhausted → `lose move-limit`; then `timeLimitSec` reached → `lose time-up`.
6. Deadlock guard: if no legal action remains, reshuffle (≤ 32 seeded shuffles, then a forced bottom-left pair) and emit `shuffle`.
7. `finalizeScore` on terminal states. Events emitted: `pop, special-create, fire, blast, chain, fall, refill, wave, win, lose, shuffle`.

### Scoring (`POP_PT=10, GROUP_PT=15, ROCKET_PT=150, BOMB_PT=400, CHAIN_PT=75, MOVE_PT=25, TIME_PT_PER_SEC=5, WAVE_PT=100`)
- `popPoints += 10` per cube cleared (by group or blast). `groupBonus += 15 × (n − minGroup)` per group. `specialBonus += 150` per rocket, `400` per bomb forged. `chainBonus += 75 × (extra specials fired in one move)`; `chainsBest` records the largest chain size.
- Win bonuses: `moveBonus = 25 × unused moves` (move-limited stages); `timeBonus = 5 × whole seconds under par.timeSec` when `elapsedMs > 0`.
- Endless: `waveBonus += 100 × newWaveNumber` per completed wave.
- `total = popPoints + groupBonus + specialBonus + chainBonus + moveBonus + timeBonus + waveBonus` (integers throughout; `currentScore` shows the running sum in the HUD).
- **Worked example:** on a 6-wide wall the top row is six Cherry cubes; tapping the leftmost (rocketAt 5, minGroup 2) clears 5 cubes and leaves a row rocket on the tapped cell: `popPoints 50 + groupBonus 60 (4 × 15) + specialBonus 150 = 260`, `bestGroup 6`, Cherry goal +5. Tapping that rocket next clears its row: 6 cells at 10 each plus the rocket's own cube at 10 = 70 more points (see Known limitations for the double count of the rocket cell).

### Win, lose, stars, ties
- **Win:** all quotas met (`goals-complete`). **Lose:** `move-limit`, `time-up` or `resigned`. Endless never "wins": it ends when `moveBank − moves ≤ 0`.
- **Stars** (`Session.stars`): 1 for finishing, +1 if `moves ≤ par.moves`, +1 if `elapsedMs ≤ par.timeSec × 1000`. Journey and challenge stars persist as the best per stage; total stars unlock themes.
- **Daily leaderboard tie order** (`server.js` `rankEntries`): won before lost, higher score, fewer invalid actions, lower elapsed time, then stable `entryId`.

### RNG and seeding
- Master seed → `RNG.derive(seed, STREAM_RULES)` for the board and refills; `STREAM_DECOR` for the title mosaic; `STREAM_AV` is reserved for audio variants. Same config + same command log ⇒ identical `hashState` (property-tested).
- Journey seeds are fixed (201-240), challenges 501-506, lessons 9001-9007, practice presets use the seed the config carries (none: `seed >>> 0 = 0`), daily = FNV-1a of `cubepop-daily-v1-YYYY-MM-DD`, score chase = `Math.random()` per run.

### Undo and hints
- Undo (`Session.undo`) pops a 30-deep stack of serialised prior states, removes the last `pop` from the replay log, and is allowed only when `cfg.mechanics.undo` is true. It is a real command-log edit, so the envelope stays replayable.
- Hint (`Rules.hint`) uses `legalActions` and returns the first of: a bomb-forging group, a rocket-forging group, a special whose blast touches another special, the largest group of a still-needed colour, the largest group, any special. The UI moves focus there, outlines it in gold and explains `why`.

## 4. Modes and progression (`js/content.js`, `js/ui.js`)

| Mode | Screen | Content | Assists | Persists |
|---|---|---|---|---|
| Journey | `#screen-journey` | 40 authored stages `j01-j40`; stage N+1 unlocks when N is completed; mastery stages at 10, 20, 30, 40 | undo + hint | `progress.completed`, `progress.stars` |
| Daily Challenge | `#screen-daily` | One immutable config per UTC day from `dailyConfig(date)`; shows seed, size, colours, limits, countdown to next day, today's server board | undo + hint | `dailyBest[date]`, `progress.dailiesDone`, server entry |
| Practice | `#screen-practice` | Casual 6×6/4 colours/no limit; Apprentice 7×7/5/20 moves; Expert 8×8/6/20 moves | undo + hint | nothing ranked |
| Challenge | `#screen-challenge` | `c1-c6`: 3-colour 14-move; 90 s speed; 9 moves no assists; bombs at 7; rockets at 4 no bombs; move + time limit no assists | per card | `progress.stars` |
| Score Chase | `#screen-score` | Endless Wall: 8×8, 5 colours, bank of 20 moves +12 per wave, quotas grow `4 + 2×wave` over `min(5, 2 + ⌊wave/3⌋)` colours | none | local top-10 runs |
| Learn | `#screen-learn` | 7 lessons on 5×5 fixture grids: pop, forge rocket, fire rocket, chain, forge bomb, finish stage, undo | per lesson | `progress.completed[t1..t7]` |

**Difficulty curve (journey):** 6×6 with 4 colours (j01-j09) → 7×7 with 5-6 colours (j10-j20) → 8×8 with 6 colours (j21-j40). Rockets enter at j03, move limits at j04, bombs at j06, time limits at j15/j23/j28/j33/j38. Quotas rise from 10+10 to 24×4; move limits sit 2-6 above `par.moves`.

**Daily rotation** (`rot = dayNumber mod 7`): colours `4 + rot mod 3`, `2 + rot mod 2` quotas of `12 + 2·rot`, 8×8 when `rot ≥ 4`, rockets at 4 on `rot 5`, bombs at 7 on `rot 3`, `16 + rot` moves, 150 s limit on `rot 6`, theme `THEMES[rot mod 5]`.

**Unlocks:** themes by total stars — Sunny Studio 0, Mint Workshop 12, Twilight Loft 30, Candy Corner 55, Ivory Attic 85. Achievements (11, `Content.ACHIEVEMENTS`) unlock idempotently in localStorage and toast on first unlock.

## 5. Controls and interaction

| Action | Keyboard | Pointer / touch | Gamepad |
|---|---|---|---|
| Move focus | Arrow keys | hover (mouse) previews the group | D-pad / left stick |
| Pop / fire | Enter, Space | tap a cube (< 600 ms, < 12 px travel) | A (0) |
| Hint | H | Hint button | Y (3) |
| Undo | U | Undo button | X (2) |
| Pause | P, Escape | Pause button; tab hidden auto-pauses | B (1), Start (9) |
| Resume | Escape (while paused) | Resume button | — |
| Orbit camera | — | drag on the board (yaw ±0.35 rad, pitch −0.15..0.3) | — |
| Reset camera | C | Camera button | — |

- Pointer picking raycasts an invisible plane at the cube face depth; cubes and particles never intercept rays (`render.js` `_initInput`). Pointer capture is taken on down and released on up/cancel.
- **Input locking:** `tryPop` accepts input only in state `active`; a successful pop sets `resolving` and `inputLocked` until the renderer's event timeline lands (`playEvents` returns its duration; reduced motion returns 0). Pausing mid-resolution defers completion (`pendingResolution`) until resume.
- **Feedback for every input:** focus ring + `cube-select` tick on arrows; group outline and 0.12 lift on hover/focus (red outline when illegal); toast + assertive announcement + `invalid-buzz` on rejection; pops, forges, fires, chains, shuffles, goal fills, waves and results each have a sound, a caption and a live-region sentence.
- Command ids `c<seq>-<time36>` make double commits idempotent; there is no debounce timer.

## 6. Screens and UI flow (`ui.js` `setState`, `showScreen`)

`boot → title → (journey | daily | practice | challenge | score | learn | achievements | settings | help) → preparing → countdown → active ⇄ paused → resolving → results → (title | next round)`. `document.body.dataset.gameState` mirrors the state for styling and tests. Each screen is a `<section class="screen" data-screen>`; `showScreen` hides the others and focuses the first heading or button.

- **Title:** key art hero (`assets/title-keyart.webp` over a procedural cube mosaic canvas), `Play: <next stage>`, conditional `Resume saved round`, 9-button mode grid, progress line (journey count, stars, achievements).
- **List screens:** `levelCard` buttons with name, meta (`moves · seconds · size · colours`), stars, lock note, intro; Back button last.
- **Game:** three-column grid ≥ 1024 px (goal rail 180-240 px · playfield · status rail 150-200 px, action tray below). 600-1023 px stacks goals / playfield / stats / tray. < 600 px tightens gaps and wraps the stats. Landscape ≤ 500 px tall: goal rail left, playfield right, stats float top-right, tray under the playfield. Safe-area insets pad the top bar, screens, tray, toast and overlays; `body.left-handed` reverses the tray.
- **Overlays:** countdown (`3 2 1 Pop!`, skipped under reduced motion), pause dialog (Resume, Settings, Help, Restart, Leave), results dialog (banner on wins, headline, breakdown table, stars, daily submit box, Retry / Next / Menu, replay envelope `<details>`), WebGL-fail card (continue with the visible grid).
- **Never cut off:** the action tray (bottom safe area), the goal rail, HUD score/moves/time, overlay buttons (`overlay-card` scrolls at `max-height: 90vh`), toasts (`max-width: 80vw`).

## 7. Art direction

**Palette (CSS tokens, `css/style.css`):** background `#f6e3c8`, panel `#fff8ee`, ink `#3d2f23`, soft ink `#6d5b48`, accent `#e4574f`, accent-2 `#f2c14e`, focus `#2e6fe4`, danger `#b3352e`. High-contrast mode swaps to `#ffffff / #000000 / #b3001b / #0033cc`.
**Cube colours** (`Content.COLORS`, high-contrast variant in brackets): Cherry `#e4574f` (`#d62828`), Lemon `#f2c14e` (`#f5d90a`), Leaf `#5da85f` (`#17a398`), Sky `#5b8fd4` (`#2e6fe4`), Grape `#9a6fc8` (`#8e24aa`), Tangerine `#ef8b4a` (`#ef6c00`). Charms are cream `#fff6e8`: sphere, star, cone, octahedron, torus, icosahedron.
**Themes** (`Content.THEMES`, wall / table / accent): Sunny Studio `#f6e3c8 / #c98d5f / #ff9d5c`; Mint Workshop `#d8efe0 / #7fae8e / #6fce9a`; Twilight Loft `#2c3350 / #4a4f78 / #8fa8ff`; Candy Corner `#fbe0ea / #d887ac / #ff8fb8`; Ivory Attic `#f2eee6 / #b8a88e / #e8c07a`. Each also sets floor, frame, key-light and fog colours.

**Shape language:** rounded-square extrusions with bevels (`roundedCubeGeo`, radius 18 % of the edge), specials as a cube with a cone-and-fin rocket or a sphere-and-fuse bomb on top, chunky shelf props (spheres and cones). UI uses 12 px radii, 2 px translucent borders and pill toasts.
**Typography:** system UI stack, 16 px base (20 px with Larger text), tabular numerals for score, moves, time and quotas; 70 ch maximum line length on menu screens.
**Lighting:** ACES tone mapping at exposure 1.05, warm directional key (theme `light`) with 1024² PCF soft shadows, hemisphere fill, low ambient, fog at 18-40 units. The hero of the screen is the cube wall: the camera (38° fov) frames it to fill the playfield; environment stays desaturated and behind.
**Motion:** pop 160 ms shrink with 10-particle bursts, fall 220 ms smoothstep, blasts 260 ms staggered 90 ms per chain step with camera shake ≤ 0.3, refill drops from above (340 ms), shuffle 450 ms, win/wave confetti ring. Quality tiers cap DPR (2 / 1.5 / 1), shadows and particle counts (160 / 80 / 30). **Reduced motion:** no countdown, no tweens (state snaps via `syncToState`), no shake, no hover lift, no button transitions.

**Visual assets the design calls for:** title key art (studio wall at rest), results celebration banner (rocket launch over cubes), a wood-grain table texture, a hero toy-rocket model, cover art and icon. All exist; see §15.

## 8. Audio direction (`js/audio.js`)

**Philosophy:** toy-box foley. Every sound is a small physical object — plastic cubes, wooden blocks, marimba bars, a tin whistle. Nothing is louder than the bomb. Sounds are tiered: input acknowledgement (click, select) < move (pop, undo) < reward (forge, fire, chain, goal fill, wave) < round end (win, lose, achievement).
**Buses:** `master ← music | effects | ambience`, each with a settings slider (defaults 0.5 / 0.8 / 0.4) and a global mute. The context is created on the first user gesture (`Audio.unlock`), suspended on pause and hidden tabs.
**Music:** a seeded pentatonic loop synthesised in `startMusic` (five scales, one per theme, 420 ms step). **Ambience:** `studio-ambience.opus` loops on the ambience bus once decoded; a two-oscillator hum plays until then or if the clip fails.
**Samples:** each event prefers its Opus clip (lazy-fetched after unlock and cached) and falls back to the synthesised transient in the same function, so the cue always fires. All event sounds also emit a caption when captions are on.

| Event id | File | Description | Usage context |
|---|---|---|---|
| `click` | `ui-click.opus` | crisp plastic button click, dry | every menu button, Play, Resume |
| `invalid` | `invalid-buzz.opus` | soft low buzzer | rules rejected a pop |
| `select` | `cube-select.opus` | tiny plastic tick | arrow-key focus move |
| `pop` | `cube-pop.opus` | cubes bursting with an airy puff | legal group popped |
| `rocketCreate` | `rocket-forge.opus` | rising whirr + metallic snap | rocket forged (5+ group) |
| `rocketFire` | `rocket-launch.opus` | toy rocket whoosh with fizzy trail | rocket tapped |
| `bombCreate` | `bomb-forge.opus` | rounded clunk + low hum | bomb forged (8+ group) |
| `bombFire` | `bomb-blast.opus` | muffled cartoon explosion | bomb tapped |
| `chain` | `chain-surge.opus` | ascending bell pings | ≥ 2 specials in one move |
| `shuffle` | `board-shuffle.opus` | wooden blocks rattling | deadlock reshuffle |
| `undo` | `move-undo.opus` | tape rewind whizz | undo |
| `hint` | `hint-chime.opus` | single glass chime | hint shown |
| `win` | `stage-win.opus` | glockenspiel victory jingle | goals complete; lesson complete |
| `lose` | `round-lose.opus` | soft descending marimba | out of moves / time / bank |
| `wave` | `wave-clear.opus` | sweep of airy chimes | endless wave complete |
| `achievement` | `achievement-unlock.opus` | chime arpeggio + key turn | first unlock of a key |
| `countdownTick` | `countdown-tick.opus` | one toy-xylophone tap | "3", "2", "1" |
| `countdownGo` | `countdown-go.opus` | whistle pip + pop | "Pop!" |
| `goalFill` | `goal-fill.opus` | two-note marimba + wooden knock | a colour quota reached mid-round |
| `timeWarning` | `time-warning.opus` | kitchen-timer double tick | clock first under 15 s |
| `ambience` | `studio-ambience.opus` | cosy workshop room tone, 12 s loop | whole round, ambience bus |

`sfx/manifest.txt` is generated from this table and is the binding source of truth.

## 9. Localization

**Shipped language:** English only. Every string is authored inline in `index.html` (screen copy, settings labels, help table), `js/ui.js` (announcements, toasts, results labels, hint reasons) and `js/content.js` (stage names, intros, lesson text, achievement names). `<html lang="en">` is fixed and there is no language selector.
**Contract (design intent, see §17):** ship en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT from a string table keyed by id, chosen from `navigator.languages` with a settings override; layouts already reserve 30 % expansion (cards wrap, tray wraps, overlay cards scroll, `max-width: 70ch`).

## 10. Accessibility

- **Keyboard-only path:** skip link → title buttons → any screen → game: arrows move the focus ring on the 3D wall and the mirror grid in lock-step, Enter pops, H/U/P/C act, overlays trap focus on their first button and restore `lastFocusEl` on resume. No hover-only information: focus previews the same outline hover does.
- **Screen reader:** `#board-mirror` is a table of buttons labelled `Row r column c: Colour, group of n | row rocket | column rocket | bomb | empty`; `#live-status` (polite) announces stage intro, legal-move summary, every pop with score, hints, waves, shuffles, pauses and results; `#live-alert` (assertive) carries rejections and context loss. Goal rail rows read `Colour have / need`.
- **Colour independence:** each colour has an icon, a label and a 3D charm shape; goal swatches carry the icon; hint outline is gold, invalid outline red, both with text.
- **Settings:** reduced motion (also honours `prefers-reduced-motion` for CSS), high-contrast cube palette and UI tokens, larger text, left-handed tray, captions for sounds, quality tier, theme, replay tutorial, reset progress.
- **Targets and contrast:** buttons ≥ 44 × 44 px with 8 px gaps; ink `#3d2f23` on `#fff8ee` ≈ 10.9:1; focus outline 3 px `#2e6fe4`.
- **Grid mode:** when WebGL is missing or the context is lost, the mirror grid becomes visible and remains fully playable with the same commands.

## 11. StarHermit integration

Manifest `starhermit.txt`: `name=Cube Pop`, `launch=index.html`, `owner=<uuid>`, `server=server.js`, `cover=coverart.png` (conventions per https://wiki.starhermit.com/).
**Used:**
- **Game script** (`server.js`): same-origin `GET /api/v1/time` (server clock; client computes a round-trip-adjusted offset in `Session.syncTime`, UTC shown in the top bar), `GET /api/v1/daily/board?date=` (top 50 ranked entries), `POST /api/v1/daily/submit` (name ≤ 24 chars, date not in the future, envelope re-simulated from the daily seed: schema 1, content version 1, initial and final hash match, no duplicate ids, legal commands, claimed score equal, elapsed ≥ 100 ms per move; 20 requests per IP per minute; one entry per name per day; days can be flagged `excluded`).
- **Leaderboard:** daily only, server-validated. Offline: casual name entry (`Guest` default). Hosted: submissions and board rows use the account nickname from the platform profile (the name field is read-only).
- **Sessions:** solo and local; the daily is an asynchronous seeded session with a replay envelope (`Session.envelope`: schema, build `1.0.0`, content version, config id, seed, initial hash, ordered commands, periodic hashes every 5 commands, invalid count, assists, result, final hash).
**Used (hosted):** `js/platform.js` reads `#game_token=<jwt>` from the URL fragment (stripped after the read; query forms for local dev), decodes `sub` + `game_scope` (never hard-coded), sends `Authorization: Bearer` on every call, and re-mints every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry). The top bar shows "Playing as <nickname> · sync status" from `GET /api/v1/users/{sub}/profile` (never usernames, never `/api/v1/me`). The checksummed progress document mirrors to one zip+base64 cloud slot at `GET/PUT /api/v1/me/cloud-saves/{slug}` — remote wins on boot (validated by `CPSession.loadProgressRaw`), saves debounce 2 s and flush on `pagehide`/hidden with keepalive. The own-server validated daily submit/board/time routes keep working as its-backend with graceful fallback, now carrying the account id.
**Not used:** presence heartbeats, platform achievements (local only), friends filtering, realtime rooms, matchmaking, chat, voice. The client is fully offline-capable: without a token it makes the same local-only calls as before, the top bar shows `offline-capable`, the daily screen shows an offline note and scores are kept locally.

## 12. Technical architecture

- **Module contract:** `rules` is pure (no DOM, no clock, no `Math.random`); `content` is data plus the daily/tutorial generators; `session` is the only writer of rules state on the client and owns ids, undo, snapshots and the envelope; `render` consumes state snapshots and event lists; `ui` owns screens, timers and settings; `audio` owns WebAudio. Script order in `index.html`: rng → rules → content → audio → session → ui → main (module).
- **Determinism and replay:** 32-bit mulberry32 with stored `rngState`; quantised `elapsedMs`; `hashState` over a stable-stringified state without `events`; server re-simulation is the acceptance test for daily scores. `tools/validate-content.js` proves legality, reachable goals, no soft locks and bounded duration for every shipped config.
- **Persistence (localStorage):** `cubepop:settings:v1`, `cubepop:progress:v1` (`v, stars, completed, dailiesDone, totalCubes, sum` — corrupt checksum resets safely), `cubepop:achievements:v1`, `cubepop:saved-round:v1` (config, serialised state, commands, init hash), `cubepop:daily-best:v1`, `cubepop:score-best:v1`, `cubepop:name`. Tutorials are never snapshotted.
- **Rendering budget:** one `InstancedMesh` per colour for cubes and one for charms (≤ 64 instances each), ≤ 12 special groups, 80 pooled marker quads, one 2048-point particle buffer, ≤ 20 environment meshes: about 30 draw calls. Rendering stops while the tab is hidden. Quality tier auto-resolves from cores / memory / mobile UA and can be forced.
- **Resilience:** WebGL absent → compatibility card and grid mode; context lost → alert and grid mode with the round intact; missing images hide themselves (`onerror`), missing texture keeps the flat colour, missing clip keeps the synth cue; API failure keeps the game playable.
- **E2E automation:** `tests/e2e.mjs` serves the repo with an embedded static server (no API), launches system Chrome via `playwright-core`, and for desktop (1280×800) and mobile (390×844, touch) clicks the real buttons: settings → reduced motion, daily screen offline note, Play, keyboard pops chosen by reading the mirror grid, Undo, Hint, Pause/Resume, plays stage 1 to the results card, returns to the title and checks persisted progress. Any console error or page error fails the run.

## 13. Testing and acceptance criteria

`npm test` (`tests/rules.test.js`, 37 tests): deterministic creation; fresh boards always have a move; group detection; every rejection reason; pop/goal/refill; monotonic tick; gravity; rocket at 5+, column orientation, bomb at 8+; row-rocket and bomb blast shapes; chains; specials never join groups; win bonuses; move, time and resign losses; reshuffle guard; endless banking; hint preferences; serialisation round-trip; replay property (same log ⇒ same hashes); failed commands never mutate; malformed-command fuzz; 200-seed random-play fuzz (no NaN, no dead states); all 40 journey stages well-formed and the first five greedy-winnable; challenges/practice/score chase well-formed; daily determinism; lesson fixtures legal and goals reachable; golden outcome hash; interrupted + resumed equals continuous play; tick expiry.

`npm run test:e2e` passes when both viewport passes complete every step above with zero console errors. `node tools/smoke-server.js` boots `server.js`, plays a daily round, submits the envelope and reads back the board.

QA bar (agents/qa.md) as checkable statements: (1) a new player sees instructions in the first stage intro, the Learn lessons and Help before any mechanic is required; (2) every mode, setting, overlay and button is reachable and works in the browser at 1280×800 and 390×844; (3) no console errors or warnings during a full playthrough; (4) no text or control is cut off on desktop, portrait or landscape mobile; (5) daily scores go through the StarHermit game script.

## 14. Performance budgets
60 fps on desktop at `high`; 30 fps floor on low-end mobile at `low` (DPR 1, no shadows, 30 particles per burst). Frame work is instance-matrix writes for ≤ 64 cubes + charms, a 2048-point particle update and one render; no per-frame allocations beyond three reusable math objects. Total shipped payload ≈ 0.7 MB core (three.js 670 KB) + 60 KB images + ~0.5 MB audio (lazy) + 1.4 MB optional model (not loaded).

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/title-keyart.webp` (1200×675, 34 KB) | Title hero over the mosaic canvas | FLUX.2 klein, seed 2712 | generated in this pass, wired (`#title-keyart`) |
| `assets/results-banner.webp` (1024×320, 12 KB) | Win / lesson-complete banner in the results card | FLUX.2 klein, seed 2713 | generated in this pass, wired (`#results-banner`) |
| `assets/table-wood.webp` (512×512, 3 KB) | Repeating wood grain on the studio table | FLUX.2 klein, seed 2715 | generated in this pass, wired (`render.js` `_loadWoodTexture`) |
| `assets/toy-rocket.glb` (1.4 MB) | Hero toy-rocket prop for specials / title | FLUX.2 klein seed 2714 → TRELLIS seed 2714 | generated in this pass, shipped, not yet wired (no GLTF loader vendored) |
| `coverart.png` (1200×675, 221 KB) | Platform cover | FLUX.2 klein seed 2712 + ffmpeg title overlay | replaced placeholder in this pass |
| `icon.png`, `favicon.svg` | Platform icon, tab icon | authored | shipped |
| `sfx/*.opus` (16 original clips) | Event sounds, §8 | MOSS-SFX v2, 100 steps | shipped |
| `sfx/countdown-tick.opus`, `countdown-go.opus`, `goal-fill.opus`, `time-warning.opus`, `studio-ambience.opus` | New cues, §8 | MOSS-SFX v2, 100 steps | generated in this pass, wired with synth fallbacks |
| `vendor/three.module.min.js` | Renderer library | three.js | shipped |

## 16. Known limitations

- A fired special's own cell is counted twice (once by the caller, once inside `detonate`'s blast loop): +10 points and +1 goal count extra per fired special. It is deterministic and the server replays the same code, so leaderboards stay consistent; fixing it changes golden hashes.
- Only English ships (§9).
- Resuming a saved round always starts theme-0 music and cannot resume tutorial lessons (by design they are never snapshotted).
- The camera orbit persists between rounds until the player presses C / Camera.
- Score Chase seeds are `Math.random()`: runs are replayable from the envelope but not shareable by seed; its best list is local only.
- Achievements and progress are localStorage only; clearing site data loses them.
- The ambience bed first plays from the second round of a session (the clip decodes during the first round while the synth hum runs).
- `tests/e2e.mjs` cannot exercise daily submission (it serves without the API); that path is covered by `tools/smoke-server.js` instead.
- `assets/toy-rocket.glb` ships unused.

## 17. Design intent not yet implemented

- String table and locale selection for the nine required locales (§9).
- Load `assets/toy-rocket.glb` (vendored GLTFLoader) for the rocket special and a spinning title prop, falling back to the procedural cone rocket.
- Send achievements through the platform; global and friends boards for Score Chase with a seed shared per UTC day (identity and validated daily submissions are done).
- Authored music stems per theme in place of the synthesised pentatonic loop.
- Count the fired special's cell once (with a golden-hash update and content version bump).
