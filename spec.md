# Cube Pop — Game Design Document (running spec)

**Pitch:** Tap a cluster of matching toy cubes to pop it; pop five to forge a rocket, eight to forge a bomb, and set them off in chains to fill colour quotas on a cheerful 3D toy-studio wall.
**Genre:** Cluster-pop puzzle (single tap, gravity refill, colour quotas). **Players:** 1, with a per-device daily board. **Session:** 1–4 minutes per round; 40-stage journey, 6 challenges, 7 lessons, daily seed, endless score chase.
**Platforms:** a StarHermit engine script game (engine 1.27.0, host API 1.29, `engine.minor=29`): played natively by the StarHermit client and in desktop and mobile browsers by the engine's web runtime; portrait and landscape, keyboard, mouse, touch and gamepad.
**Rendering:** `starhermit:scene` (three.js-like) draws an instanced wall of rounded cubes in a lit toy studio; every menu, HUD element and dialog is `starhermit:ui` (immediate mode, styled from `assets/ui-style.json`), with an accessibility tree screen readers read (each cube is a named target).

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: name, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.entry=native/main.ts`, engine 1.27.0 / minor 29, capabilities `platform,storage,clipboard`, `control.*` keys and `engine.gamepad.*` buttons for every action |
| `index.html`, `starhermit-files.json` | The web loader and file index written by `npm run package` (`starhermit package --web .`; pins the engine on wiki.starhermit.com by hash — never edit them) |
| `native/main.ts` | Entry: state machine (title → lists → countdown → active ⇄ paused → resolving → results), round lifecycle and snapshot, event presentation, lessons, input (actions, wall taps and drag orbit), the fixed-step round clock, time limits, results, lifecycle |
| `native/screens.ts` | Every screen, the HUD, the countdown, pause and results dialogs, toasts and captions (starhermit:ui), layouts by window size |
| `native/render.ts` | The studio on starhermit:scene: lights, room, table, shelf, cubes and charms, specials, confetti, dust motes, markers, camera fitted to the playfield, picking, the post chain per look |
| `native/quality.ts` | The browser build's presets and budgets keyed by the runtime's quality tier and level |
| `native/audio.ts` | Opus one-shots per event, the room-tone loop, the pentatonic music rendered into clips, captions |
| `native/platform.ts` | The save (progress document, cloud-synced, foreign-save migration, conflict merge), the localStorage shim, the game's settings and legacy-setting migration, player, invite link, platform clock, leaderboard posting |
| `native/classic.ts`, `native/i18n.ts`, `native/style.ts`, `native/glyphs.ts` | Loads the classic scripts below with their types; the interface language; the style sheet and high-contrast tokens; the colour icons drawn as shapes |
| `js/rng.js` | mulberry32 PRNG, FNV-1a `hashString`, three derived streams (rules / decor / AV) |
| `js/rules.js` | Pure deterministic rules engine: `createGame`, `applyCommand`, legality, scoring, hints, hashing, serialisation |
| `js/content.js` | Versioned content: 6 cube colours, 5 themes, 40 journey stages, 6 challenges, 3 practice presets, score-chase ruleset, daily generator, 7 lessons, 11 achievements |
| `js/session.js` | Round lifecycle over the engine: command ids, undo stack, replay envelope, stars, the progress / achievement / snapshot documents in `localStorage` (the engine's shim), the device's daily board; `Session.clock` (the round clock hook) |
| `js/i18n.js`, `js/locales/*.js` | `CPI18n`: `T(US-English text, vars)` over the per-language dictionaries |
| `assets/` | `title-keyart.webp`, `results-banner.webp`, `table-wood.webp`, `ui-style.json` (generated from `tools/ui-style.css`) |
| `sfx/` | 21 Opus clips, `manifest.txt` (canonical), `manifest.json` (generator input), `manifest.md` (generator output) |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished round's total and posts it to the `high-score` leaderboard |
| `server.js`, `data/` | Local dev server (static files, `/api/v1/time`, legacy daily routes no client calls); left out of the package |
| `tests/` | `rules.test.js` (37 rules/content tests), `session.test.mjs`, `i18n.test.mjs` (+ `i18n-keys.mjs`), `native.mjs` with `native/*.play` play scripts |
| `tools/` | `gen-plays.mjs` (play scripts from the rules), `browser-play.mjs` (GPU Chrome play of the web package), `package-web.mjs`, `css.mjs` + `ui-style.css`, `validate-content.js`, `smoke-server.js` |
| `.starhermitignore` | Leaves tests/, tools/, server.js, spec.md, coverart.png and data/ out of the package |
| `cover.jpg`, `coverart.png`, `icon.png`, `LICENSE.md` | Platform cover, 1200×675 cover art, 256 px icon (also the web page's icon), PolyForm Noncommercial 1.0.0 |

## 1. Vision and design pillars

Cube Pop is the feeling of sweeping a shelf of toy blocks off a table with one finger: immediate, tactile and a little bit greedy. The whole design serves one question the player asks every second: *which cluster do I pop now?*

1. **Every tap pops something.** Minimum group is 2, `createGame` and every `applyCommand` call `guaranteeMove` so a legal action always exists, and a deadlocked wall reshuffles itself for free (`rules.js` `guaranteeMove`, event `shuffle`). Rules in: free reshuffles, loose quotas early on. Rules out: "no moves left" losses, boards you have to stare at.
2. **Big groups forge tools.** Specials are never given, only earned: a 5+ group leaves a rocket on the tapped cube, an 8+ group a bomb, and blasts detonate other specials into chains (`applyCommand`, `detonate`). Rules in: hunting for size, planning where the special lands. Rules out: boosters, purchased power-ups, random specials from refills.
3. **The wall is a toy, not a screen.** Rounded bevelled cubes with cream charms, a wooden table, a shelf of props, warm key light, plastic pops and marimba stings. Rules in: soft edges, matte plastic, wood, confetti. Rules out: neon, glass, glitch effects, abstract grids.
4. **One engine, everywhere.** Tutorial fixtures, hints, undo and the client all run the same `CPRules` on the same seeds; every round carries a replay envelope that re-simulates to the identical final hash. Rules in: shareable seeds, replay envelopes, inspectable RNG. Rules out: hidden difficulty tuning, unverifiable scores.
5. **Playable without the picture.** Named cube targets for screen readers, announcements, captions and a keyboard focus ring are first-class; the 3D view is a lens on the same state. Rules in: labels on every cell, colour + icon + charm redundancy. Rules out: canvas-only controls, hover-only information.

## 2. Player experience

**Target player:** anyone who enjoys short colour-matching puzzles; no genre literacy assumed. Rounds fit a commute stop; the journey rewards returning for 20-30 sessions.

**First 60 seconds (as implemented):** the title shows the key art and a dominant `Play: First Pops` button (the title names the next uncompleted stage). One click starts journey stage 1 — a 6×6, 4-colour wall with two 10-cube quotas, no limits and no specials — after a 3-2-1-Pop! countdown. The stage card's `intro` text ("Tap any group of 2+ matching cubes…") is announced on activation; hovering or focusing a cell lifts and outlines its whole group, so the first legal move is visible before it is taken. Invalid taps buzz and toast the reason. Stages 3, 4, 6, 7, 9, 15 and 16 each introduce exactly one new idea in their `intro` line (rockets, move limit, bombs, chains, fifth colour, time limit, sixth colour). The **Learn** screen holds seven fixture-grid lessons that each require the player to perform the rule (`Content.tutorialLessons`, `Session.lessonGoalMet`).

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
- **Daily board tie order** (`CPSession` `rankEntries`, local): won before lost, higher score, fewer invalid actions, lower elapsed time, then stable `entryId`.

### RNG and seeding
- Master seed → `RNG.derive(seed, STREAM_RULES)` for the board and refills; `STREAM_DECOR` for the title mosaic; `STREAM_AV` is reserved for audio variants. Same config + same command log ⇒ identical `hashState` (property-tested).
- Journey seeds are fixed (201-240), challenges 501-506, lessons 9001-9007, practice presets use the seed the config carries (none: `seed >>> 0 = 0`), daily = FNV-1a of `cubepop-daily-v1-YYYY-MM-DD`, score chase = FNV-1a of the platform clock per run.

### Undo and hints
- Undo (`Session.undo`) pops a 30-deep stack of serialised prior states, removes the last `pop` from the replay log, and is allowed only when `cfg.mechanics.undo` is true. It is a real command-log edit, so the envelope stays replayable.
- Hint (`Rules.hint`) uses `legalActions` and returns the first of: a bomb-forging group, a rocket-forging group, a special whose blast touches another special, the largest group of a still-needed colour, the largest group, any special. The UI moves focus there, outlines it in gold and explains `why`.

## 4. Modes and progression (`js/content.js`, `native/main.ts`)

| Mode | Screen | Content | Assists | Persists |
|---|---|---|---|---|
| Journey | Journey | 40 authored stages `j01-j40`; stage N+1 unlocks when N is completed; mastery stages at 10, 20, 30, 40 | undo + hint | `progress.completed`, `progress.stars` |
| Daily Challenge | Daily Challenge | One immutable config per UTC day from `dailyConfig(date)`; shows seed, size, colours, limits, countdown to next day, today's board on this device | undo + hint | `dailyBest[date]`, `progress.dailiesDone`, `daily-boards` entry |
| Practice | Practice | Casual 6×6/4 colours/no limit; Apprentice 7×7/5/20 moves; Expert 8×8/6/20 moves | undo + hint | nothing ranked |
| Challenge | Challenge | `c1-c6`: 3-colour 14-move; 90 s speed; 9 moves no assists; bombs at 7; rockets at 4 no bombs; move + time limit no assists | per card | `progress.stars` |
| Score Chase | Score Chase | Endless Wall: 8×8, 5 colours, bank of 20 moves +12 per wave, quotas grow `4 + 2×wave` over `min(5, 2 + ⌊wave/3⌋)` colours | none | local top-10 runs |
| Learn | Learn | 7 lessons on 5×5 fixture grids: pop, forge rocket, fire rocket, chain, forge bomb, finish stage, undo | per lesson | `progress.completed[t1..t7]` |

**Difficulty curve (journey):** 6×6 with 4 colours (j01-j09) → 7×7 with 5-6 colours (j10-j20) → 8×8 with 6 colours (j21-j40). Rockets enter at j03, move limits at j04, bombs at j06, time limits at j15/j23/j28/j33/j38. Quotas rise from 10+10 to 24×4; move limits sit 2-6 above `par.moves`.

**Daily rotation** (`rot = dayNumber mod 7`): colours `4 + rot mod 3`, `2 + rot mod 2` quotas of `12 + 2·rot`, 8×8 when `rot ≥ 4`, rockets at 4 on `rot 5`, bombs at 7 on `rot 3`, `16 + rot` moves, 150 s limit on `rot 6`, theme `THEMES[rot mod 5]`.

**Unlocks:** themes by total stars — Sunny Studio 0, Mint Workshop 12, Twilight Loft 30, Candy Corner 55, Ivory Attic 85. Achievements (11, `Content.ACHIEVEMENTS`) unlock idempotently in device storage and toast on first unlock.

## 5. Controls and interaction

Actions are declared in `starhermit.txt`; players rebind keys and pad buttons in the runtime's Options (Settings › Change keys and buttons opens it). Help's controls table shows the current bindings.

| Action (`control.*`) | Keyboard | Pointer / touch | Gamepad |
|---|---|---|---|
| `up` / `down` / `left` / `right` — move focus | Arrow keys | the mouse's hover previews the group under it | D-pad / left stick |
| `pop` — pop / fire | Enter, Space | tap a cube (< 600 ms, < 12 px travel) | A (South) |
| `hint` | H | Hint button | Y (North) |
| `undo` | U | Undo button | X (West) |
| `pause` — pause / back | P, Escape | Pause button; a hidden window auto-pauses | Start, B (East) |
| orbit camera | — | drag on the wall (yaw ±0.35 rad, pitch −0.15..0.3) | — |
| `camera` — reset camera | C | Camera button | right stick press |

- Menus and dialogs take Tab / arrows / Enter / Escape and the pad's D-pad / South / East (starhermit:ui); Escape on a list screen goes back to the title, in the pause dialog it resumes. F1 opens the runtime's Options.
- **Picking:** a press inside the playfield (the window rectangle the HUD leaves) is the wall's: `render.pick` casts from the camera onto the cubes' front plane. Presses are queued and decided after the frame's UI is built. A drag beyond 12 px orbits instead of popping.
- **Input locking:** `tryPop` acts only in phase `active`; a successful pop sets `resolving` until the wall's event timeline lands (`render.playEvents` returns its length; reduced motion returns 0). Pausing mid-resolution holds the timeline; it finishes after Resume.
- **Feedback for every input:** focus ring + `cube-select` tick on arrows; group outline and 0.12 lift on hover/focus (red outline when illegal); toast + assertive announcement + `invalid-buzz` on rejection; pops, forges, fires, chains, shuffles, goal fills, waves and results each have a sound, a caption and an announcement.
- Command ids `c<seq>-<step36>` make double commits idempotent.

## 6. Screens and UI flow (`native/main.ts` `app.phase`, `show`; `native/screens.ts`)

`title → (journey | daily | practice | challenge | score | learn | achievements | settings | help) → preparing → countdown → active ⇄ paused → resolving → results → (title | next round)`. The top bar (title, the platform's UTC clock, the account / sync line) shows on every screen.

- **Title:** key art hero (`assets/title-keyart.webp`, over the procedural cube mosaic until it loads), `Play: <next stage>`, conditional `Resume saved round`, 9-button mode grid (3 columns, 2 on phones), Sign in with StarHermit (signed out) / Invite a friend (signed in), progress line (journey count, stars, achievements). Below 600 px the hero stacks above the menu.
- **List screens:** level cards in a grid (auto-fill, ≥ 220 px) with name, meta (`moves · seconds · size · colours`), stars, lock note, intro; mastery stages have a gold border; Back last. Pages scroll when taller than the window and open at their top.
- **Game:** ≥ 1024 px wide: goal rail (240 px) · playfield · status rail (200 px), action tray below. Narrower: the goals (wrapping) and lesson box above the wall, the stats row and tray under it. Short landscape (≤ 500 px tall): a narrow goal rail left, the stats floating over the wall's top-right corner, the tray under the wall. Safe areas are honoured; Left-handed reverses the tray. On High and Ultra the view's corners are rounded.
- **Dialogs:** countdown (`3 2 1 Pop!` over a dim, skipped under reduced motion), pause (Resume, Settings, Help, Restart round, Leave round; Settings and Help return to it), results (banner on wins, headline, breakdown, stars, the leaderboard line when signed in, the daily name field and Save to today's board, Retry / Next / Menu / Copy replay envelope). Dialogs scroll their body with the buttons pinned below.
- **Toasts and captions** sit just above whatever is under the wall (tray or stats), never over the buttons, and take no presses.

## 7. Art direction
**Palette (style tokens, `tools/ui-style.css` → `assets/ui-style.json`):** background `#f6e3c8`, panel `#fff8ee`, ink `#3d2f23`, soft ink `#6d5b48`, accent `#e4574f`, accent-2 `#f2c14e`, focus `#2e6fe4`, danger `#b3352e`. The runtime's high contrast swaps to `#ffffff / #000000 / #b3001b / #0033cc` (`native/style.ts`) and the cubes to their high-contrast colours.
**Cube colours** (`Content.COLORS`, high-contrast variant in brackets): Cherry `#e4574f` (`#d62828`), Lemon `#f2c14e` (`#f5d90a`), Leaf `#5da85f` (`#17a398`), Sky `#5b8fd4` (`#2e6fe4`), Grape `#9a6fc8` (`#8e24aa`), Tangerine `#ef8b4a` (`#ef6c00`). Charms are cream `#fff6e8`: sphere, star, cone, octahedron, torus, icosahedron. In the UI the colour icons (♥ ★ ▲ ◆ ☾ ✿) are drawn as shapes (`native/glyphs.ts`).
**Themes** (`Content.THEMES`, wall / table / accent): Sunny Studio `#f6e3c8 / #c98d5f / #ff9d5c`; Mint Workshop `#d8efe0 / #7fae8e / #6fce9a`; Twilight Loft `#2c3350 / #4a4f78 / #8fa8ff`; Candy Corner `#fbe0ea / #d887ac / #ff8fb8`; Ivory Attic `#f2eee6 / #b8a88e / #e8c07a`. Each also sets floor, frame, key-light and fog colours.

**Shape language:** rounded-square extrusions with bevels (`roundedCubeGeo`: 10 % bevel plus 10 % corner radius, inset so the finished cube measures exactly its edge and neighbours leave a visible gap), specials as a cube with a cone-and-fin rocket or a sphere-and-fuse bomb on top, chunky shelf props (spheres and cones). UI uses 12 px radii, 2 px translucent borders and pill toasts.
**Typography:** the runtime's UI face, 16 px base (the runtime's text size scales it), tabular numerals for score, moves, time and quotas; ~640 px maximum line length on menu screens.
**Lighting:** ACES tone mapping at exposure 1.05, a warm directional key (theme `light`, 2.2/π) with soft shadows reaching over the wall, table and back wall, hemisphere fill, low ambient, a cool rim light on detailed looks, fog at 18-40 units (three.js intensities ÷ π, the engine's convention). The camera (38° fov) frames the wall to fill the playfield (`setViewOffset` places it between the HUD's rails); environment stays desaturated and behind.
**Motion:** pop 160 ms shrink with 10-particle bursts, fall 220 ms smoothstep, blasts 260 ms staggered 90 ms per chain step with camera shake ≤ 0.3, refill drops from above (340 ms), shuffle 450 ms, win/wave confetti ring, all on the runtime's fixed steps. **Reduced motion** (the runtime's option): no countdown, no tweens (state snaps), no shake, no hover lift, no ambient motion.

**Graphics.** The runtime's Options choose the graphics level (Auto from the device, or one of ten levels in four tiers), render scale, adaptive resolution and the frame-rate limit; the game reads `frame().quality` (the tier) and `frame().levelIndex` and applies the browser build's preset for that tier (`native/quality.ts`): at Detailed the cubes are soft-touch toy plastic (`MeshPhysicalMaterial` on High/Ultra, roughness 0.5, a thin 0.4 clearcoat), specials get a glossy clearcoat and the bomb fuse carries an over-bright spark; the studio gains a procedural striped wallpaper, floorboards, a skirting board and extra shelf toys (a stack of blocks, a ring). Reflections light PBR materials from `new RoomEnvironment(renderer)` through `PMREMGenerator.fromScene` as `scene.environment` at the old per-material `envMapIntensity` (0.2–0.4). The post chain is the renderer's: `renderer.ao` (GTAO, radius 0.45), `renderer.bloom` (strength 0.2, the r160 page's 0.45 squared for r185 bloom at minor 29, radius 0.4, threshold 0.9: only the fuse spark and sparkles bloom), `renderer.grade` (linear light before output, as the page's pass before OutputPass: a gentle S-curve, +10 % saturation, warm highlights / cool shadows, a 0.2 vignette) and `renderer.antialias`. High particles are larger soft round confetti with every fifth one an over-bright sparkle; animated looks add drifting dust motes in the key light, a slow key-light shimmer, an idle bob on specials and a flickering fuse. The shadow map size and MSAA samples are the level's. Changing level rebuilds the studio and cube meshes when the asset variants differ; gameplay is identical on every level.

| Tier | Shadows | AO | Bloom | Grade | AA | Reflections | Particles | Background | Detail |
|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | off | MSAA | off | low | static | plain |
| Balanced | 1024 | off | on | on | FXAA | on | high | animated | detailed |
| High | 2048 | on | on | on | SMAA | on | high | animated | detailed |
| Ultra | 4096 | high | on | on | MSAA | on | high | animated | detailed |

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Materials (room, table, cubes, charms, specials, toys) | Lambert | Standard | Physical (clearcoat when detailed) | Physical |
| Cube corner curve / bevel segments | 3 / 1 | 5 / 2 | 8 / 4 | 12 / 5 |
| Wallpaper / floorboard texture (Detailed) | — | 256 px | 256 px | 512 px |
| Dust motes (animated) | 24 | 40 | 70 | 120 |
| Particles per burst (Particles high; low tier 30) | 30 | 100 | 160 | 240 |
| Bloom / GTAO resolution | ½ / ½ | ½ / ½ | ½ / ½ | full / full |
| Rounded corners on the 3D view | off | off | on | on |

Motes and bursts grow with the level above the tier's first (≈ 1.64× a level, at most 4×), as the browser build scaled them by its hardware level.

**Visual assets the design calls for:** title key art (studio wall at rest), results celebration banner (rocket launch over cubes), a wood-grain table texture, cover art and icon. All exist; see §15.

## 8. Audio direction (`native/audio.ts`)

**Philosophy:** toy-box foley. Every sound is a small physical object — plastic cubes, wooden blocks, marimba bars, a tin whistle. Nothing is louder than the bomb. Sounds are tiered: input acknowledgement (click, select) < move (pop, undo) < reward (forge, fire, chain, goal fill, wave) < round end (win, lose, achievement).
**Buses:** the runtime's — music, effects (every game sound and the room tone) and interface (the menu click); Options › Audio owns their volumes, the mute and the voice limit. The browser build's default levels (music 0.5, effects 0.8, ambience 0.4) are folded into each sound's gain. Pause and a hidden window hold the music, the room tone and new sounds.
**Music:** the browser build's seeded pentatonic loop (five scales, one per theme, a sine note every 420 ms walking the scale, a bass note an octave down every fourth step), each note rendered once into a clip with the old envelope. **Ambience:** `studio-ambience.opus` loops under a round.
**Samples:** each event plays its Opus clip; clips load one at a time once the mixer runs (in a browser after the first press), so a cue whose clip is still loading is silent (the browser build's synthesised stand-ins are not ported). Every event sound also emits a caption when Sound captions is on.

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
| `ambience` | `studio-ambience.opus` | cosy workshop room tone, 12 s loop | whole round, effects bus |

`sfx/manifest.txt` is generated from this table and is the binding source of truth.

## 9. Localization

Nine locales ship: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**, for every player-facing string — screens, settings, help, HUD, goals and colour names, announcements and captions, toasts, results, stage/challenge/lesson/achievement/theme names and intros, and the StarHermit lines. "Cube Pop" stays untranslated.

- **Strings.** Code calls `T('US-English text', { vars })` (`native/i18n.ts` over `js/i18n.js`'s `CPI18n`); `js/locales/*.js` map that text per language (en-GB lists only the colour spellings; es-ES and fr-CA only their differences from es-419 and fr-FR). Content tables keep English source text and are translated at display time.
- **Language** is the runtime's interface language (`preferences().language`: the player's choice in Options › Language, else the account's preferred language or the device's), mapped to the nearest shipped locale; a change re-renders everything on the next frame (the UI is rebuilt every frame) and leaves the round untouched. The browser build's own Language selector and its `ui.language` account key are gone (the key is removed on first run).
- **Expansion.** Cards, the tray, button rows and goals wrap; long labels wrap inside their buttons; pages and dialogs scroll.

## 10. Accessibility

- **Keyboard and pad path:** every screen, list and dialog works with Tab / arrows / Enter / Escape (and D-pad / South / East); in a round the arrows move the focus ring on the wall, Enter pops, H/U/P/C act; dialogs focus their first button.
- **Screen reader:** starhermit:ui builds the accessibility tree; each cube is a named target `Row r column c: Colour, group of n | row rocket | column rocket | bomb | empty` (`ui.target`), and announcements (`ui.announce`) carry the stage intro, the legal-move summary, focus moves, every pop with score, hints, waves, shuffles, pauses, achievements and results (rejections assertively). Goal rows read `Colour have / need`.
- **Colour independence:** each colour has an icon, a label and a 3D charm shape; goal swatches carry the icon; hint outline is gold, invalid outline red, both with text.
- **Options:** the runtime's reduced motion, high contrast (UI tokens and the high-contrast cube palette), text size and interface size, plus the game's Sound captions and Left-handed action tray; theme, replay tutorial, reset progress.
- **Targets and contrast:** buttons ≥ 44 × 44 px with 8 px gaps; ink `#3d2f23` on `#fff8ee` ≈ 10.9:1; focus ring 3 px `#2e6fe4`.

## 11. StarHermit integration

Everything goes through the runtime's modules (`starhermit:platform`, `starhermit:storage`); signed out (a guest) the game makes no platform calls and plays fully offline.

- **Save:** the checksummed progress document (`v, stars, completed, dailiesDone, totalCubes, sum`) is the game's save (`saves`, schema 1): on the device at once, synced to the account's cloud slot when signed in. When the account's save replaces the device's (another device saved last) it is merged in (`CPSession.mergeProgress`: the better star count per stage, every completion and daily from either side, the larger cube total); a conflict resolves to the same merge. **Migration:** the browser build's cloud save (the JS SDK's `saveJSON` of the same document, key `game:<slug>`) shows as `saves.foreign()`; it is validated by its checksum, merged with this device's progress and saved over the slot once (`replaceForeign`). Guests' browser localStorage progress from the old build does not carry over (the engine's storage is its own).
- **Device storage** (the localStorage shim over `storage`): achievements (`cubepop:achievements:v1`), the saved round (`cubepop:saved-round:v1`), today's best (`cubepop:daily-best:v1`), the device's daily board (`cubepop:daily-boards:v1`, last 14 days, top 50 per day, one entry per name keeping the better run), Score Chase runs (`cubepop:score-best:v1`) and the board name (`cubepop:name`), as the browser build kept them on the device.
- **Settings:** the game's options (`captions`, `leftHanded`, `theme`) are `settings` (`game.<key>`, synced with the account). The browser build's account settings (its settings object patched key by key, and `ui.language`) are read once as legacy settings: `captions`, `leftHanded` and `theme` carry over unless set since, then every old key is removed. Volumes, mute, graphics and the accessibility options are the runtime's.
- **Player and clock:** the top bar shows `offline-capable` for guests, else "Playing as <name> · progress synced | saving… | cloud sync unavailable". The daily's date and the reset countdown use the platform's clock (`serverNow()`), the device's UTC date until it answers or offline.
- **Sign-in and invite:** guests see "Sign in with StarHermit" on the title (`requestSignIn`); signed in, "Invite a friend" copies the invite link (fetched ahead) to the clipboard with a toast, or shows it.
- **Leaderboard:** when signed in, every finished round (not lessons) posts its total through `score-script.js`: a practice session whose socket carries `{ type: 'result', scores: { 'high-score': total } }` (as the JS SDK's `submitScores` did); the script range-checks it and posts it to the `high-score` board (integer, higher is better, 0–1,000,000), and the results show "Leaderboard rank: #N" from the board's entries.
- **Daily board:** local to the device; guests type a name (`Guest` by default), signed in the account name is used.
- **Replay envelope:** `Session.envelope` (schema, build, content version, config id, seed, initial hash, ordered commands, periodic hashes, invalid count, assists, result, final hash); Copy replay envelope puts it on the clipboard.
- **Controls:** `control.*` and `engine.gamepad.*` in the manifest; the runtime rebinds them.
- **Not used:** platform achievements (achievements stay local), matchmaking, invites to sessions, chat, realtime rooms, voice.

## 12. Technical architecture

- **Module contract:** `rules` is pure (no DOM, no clock, no `Math.random`); `content` is data plus the daily/tutorial generators; `session` is the only writer of rules state on the client and owns ids, undo, snapshots and the envelope; `render.ts` consumes state snapshots and event lists; `main.ts` owns phases, timers and the round; `screens.ts` draws; `audio.ts` owns sound. The classic scripts are loaded unchanged with `loadClassic` (`native/classic.ts`), so the node tests run the shipped code.
- **Time:** `setFixedRate(60)`; the round clock (`Session.clock`) counts fixed steps of the active round only, so pauses, a hidden window and slow frames never cost time; the countdown, the pop timeline and time limits use the same steps, and play scripts replay exactly.
- **Determinism and replay:** 32-bit mulberry32 with stored `rngState`; quantised `elapsedMs`; `hashState` over a stable-stringified state without `events`. Score Chase seeds come from the platform's clock per run.
- **Rendering budget:** one `InstancedMesh` per colour for cubes and one for charms (capacity twice the cells, for refills arriving while popped cubes shrink), ≤ 12 special groups, 80 pooled markers, one 2048-point confetti cloud, ≤ 25 environment meshes, one mote cloud. The studio draws only during a round (`renderer.camera` is null on menus).
- **Resilience:** missing images leave the art out (the title mosaic shows), a missing wood texture keeps the flat colour, a missing clip is silent; platform failures keep the game playable offline.

## 13. Testing and acceptance criteria

`npm test` runs:
- `tests/rules.test.js` (37 tests): deterministic creation; fresh boards always have a move; group detection; every rejection reason; pop/goal/refill; monotonic tick; gravity; rocket at 5+, column orientation, bomb at 8+; blast shapes; chains; specials never join groups; win bonuses; move, time and resign losses; reshuffle guard; endless banking; hints; serialisation; replay property; pure failed commands; fuzz; journey/challenge/practice/score chase well-formed; daily determinism; lesson fixtures; golden hash; interrupted + resumed equals continuous play; tick expiry.
- `tests/session.test.mjs`: the `Session.clock` hook, the checksum `platform.ts` seals merged progress with, the browser build's cloud document validating and merging without losses (and a tampered one refused), the snapshot round trip with deduplicated ids, the device's daily board.
- `tests/i18n.test.mjs`: every `T`/`N` key in `js/*.js` and `native/*.ts` and every content display field exists in all nine locales with the same placeholders; no stale keys.
- `tools/validate-content.js`: legality, reachable goals, no soft locks for every shipped config.
- `tests/native.mjs`: the web index matches the files; `tsc` (TypeScript 5.9, the engine's d.ts, no skipLibCheck); `starhermit check .` with zero warnings; every `tests/native/*.play` as a signed-out `--render-check` run of the real UI: `screens.play` (every screen and back, a Score Chase run started and left, the reset question), `journey-first-stage.play` (stage 1 played by keys to the results, Next opens stage 2, Leave round → Resume saved round), `learn-lessons.play` (all seven lessons through Next), `practice-assists.play` (pop, Undo, Hint, a refused pop, Pause → Leave → Resume saved round, the round to its results), `challenge-timer.play` (Speed Pop: the 15-second warning and Time is up), `touch-pop.play` (a touch pop on the wall and the tray by touch). `npm run plays` regenerates the generated ones from the rules.

`npm run test:browser` (`tools/browser-play.mjs`) serves the package on loopback and plays it in Chrome on the machine's GPU at 1366×768, a 390×844 phone and an 844×390 landscape phone (Play, the countdown, a pop by keys or by tap, Pause by key or tap, Leave round to the title with Resume saved round), failing on console errors or warnings or the runtime's error screen. `npm run test:server` boots `server.js` and round-trips its legacy daily routes.

QA bar: (1) a new player sees instructions in the first stage's rule card, the Learn lessons and Help before any mechanic is required; (2) every mode, setting, dialog and button is reachable and works natively and in the browser at desktop, portrait and landscape phone sizes; (3) no console errors or warnings during a full playthrough; (4) no text or control is cut off; (5) finished rounds go to the leaderboard through the StarHermit game script.

## 14. Performance budgets
60 fps on desktop at High; Low draws no shadows, no post chain and 30-particle bursts. Frame work is instance-matrix writes for ≤ 64 cubes + charms, a 2048-point confetti update (only while confetti flies) and the UI; the runtime adapts resolution. Payload ≈ 1.1 MB (60 KB images, ~0.5 MB audio loaded one clip at a time).

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/title-keyart.webp` (1200×675, 34 KB) | Title hero over the mosaic | FLUX.2 klein, seed 2712 | wired (`screens.ts` hero) |
| `assets/results-banner.webp` (1024×320, 12 KB) | Win / lesson-complete banner in the results | FLUX.2 klein, seed 2713 | wired |
| `assets/table-wood.webp` (512×512, 3 KB) | Repeating wood grain on the studio table | FLUX.2 klein, seed 2715 | wired (`render.ts`) |
| `assets/ui-style.json` | The UI's styles and tokens | `starhermit css tools/ui-style.css` | generated (`npm run css`) |
| `coverart.png` (1200×675, 221 KB), `cover.jpg` | Platform cover | FLUX.2 klein seed 2712 + ffmpeg title overlay | shipped |
| `icon.png` | Platform and web page icon | authored | shipped |
| `sfx/*.opus` (21 clips) | Event sounds and room tone, §8 | MOSS-SFX v2, 100 steps | shipped |

The browser build's unused `assets/toy-rocket.glb` (1.4 MB, never loaded) was removed with the browser client.

## 16. Known limitations

- A fired special's own cell is counted twice (once by the caller, once inside `detonate`'s blast loop): +10 points and +1 goal count extra per fired special. It is deterministic and the server replays the same code, so leaderboards stay consistent; fixing it changes golden hashes.
- Resuming a saved round always starts theme-0 music and cannot resume tutorial lessons (by design they are never snapshotted).
- The camera orbit persists between rounds until the player presses C / Camera.
- Score Chase seeds differ per run: runs are replayable from the envelope but not shareable by seed; its best list is local only.
- Achievements, the saved round and the daily board are device storage only; guests' old browser localStorage progress does not migrate to the engine build (signed-in cloud saves do).
- A sound whose clip is still loading is silent (no synthesised stand-in); in a browser the clips load after the first press.
- The "Finish the stage" lesson now completes as a lesson (the browser build ended it as an ordinary round, so it never counted and "Second chances" stayed locked).
- The per-effect graphics overrides of the old Graphics panel are not offered: the runtime's Options choose a level.
- The replay envelope is copied, not shown (the old page's collapsible JSON).
- While the stats float over the wall on short landscape screens, a tap on them reaches the cube underneath.

## 17. Design intent not yet implemented

- A modelled toy rocket for the rocket special and a spinning title prop (the glTF asset was never wired and is gone).
- Send achievements through the platform; global and friends boards for Score Chase with a seed shared per UTC day.
- Authored music stems per theme in place of the synthesised pentatonic loop.
- Count the fired special's cell once (with a golden-hash update and content version bump).
