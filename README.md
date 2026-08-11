# Undercooled — browser playtest prototype

[Undercooled](https://dougathlon.github.io/undercooled/) is a desktop shared-control service game built around one central quantum processor and two workers operating its mirrored sides. The public link still serves the v0.4 playtest. This branch contains the unpublished v0.5 clarity iteration; the earlier v0.2 build remains recoverable at tag `v0.2.0-playtest.1`.

One input set controls both workers. Every v0.5 scene now performs one complete service cycle: accept a circuit job, prepare both channels, install pulse cartridges, complete any coupled operation, attach a canister, run and measure a shot, submit the result, and reset the processor. Cooling interrupts that same cycle in the fourth scene. The progression changes what can disrupt the routine rather than substituting a partial exercise for the job.

This repository is the deterministic Phaser/TypeScript prototype. Its simulation and replay boundary is kept separate from rendering so the rules can later be ported to Unity.

The v0.5 presentation preserves the bright porcelain-and-copper service workshop, selected clean blue/red worker pair, physically distinct stations, and portable service objects. It removes mobile controls and the briefing encyclopedia, dims inactive hardware, draws one route and target per lane, and puts one changing instruction above the playfield. The pale floor carries movement and risk information; the dark teal HUD carries job, thermal, and provenance information.

Risk addresses announce that a prefetched record will be consumed, but do not reveal its bits before the player commits. The resulting provenance, bit pair, affected lane or lanes, and recovery state then appear together.

## Four-level demo arc

Each scene completes the same accept → prepare → load → couple when required → measure → submit → reset spine:

1. **Learn:** one worker is visible. The player completes the full cycle while the hidden channel receives the same commands.
2. **Reveal:** the red coworker appears. Both workers fetch H from the same relative place, install H at matching ports, and visibly perform the same routine in synchrony.
3. **Disrupt:** the matched H/H recipe remains. Three coordinate-bound movement-risk squares are active. A scripted `01` drops red's cartridge, the central square's simulator records make red miss two consecutive steps, and a later scripted `01` interrupts the first readout attempt. Each square owns and consumes its own cached stream.
4. **Combine:** the matched recipe gains a coupled operation and three bilateral-capable movement-risk squares. A joint `11` first drops both coupling halves; its next `10` drops only blue's recovered half while red's installed port remains locked. The route to the lances then crosses a simulator-derived movement fault. During external cooling, a clearly labelled simulated Quantum Blur presentation pass maps classical thermal load onto increasing whole-playfield blur; spraying reduces the heat and clears the image without changing any cached quantum result.

Levels 1–3 are intended to form the complete concise presentation arc. Level 4 is an optional pressure demonstration, not a required tutorial step.

## Play locally

Requirements: Node 24 or newer and pnpm 11 or newer.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:4173/`.

Controls:

- `W` / `↑`: move both workers up
- `S` / `↓`: move both workers down
- `D` / `→`: move both workers inward, toward their respective processor faces
- `A` / `←`: move both workers outward, toward their respective supply benches
- `Space` / `E`: contextual action; hold when the instruction asks for sustained preparation or cryogenic spray
- `Escape` / `P`: pause
- `R`: restart the active shift

The demonstration is deliberately desktop-only. There is no phone orientation gate or touch-control surface.

## Verify the release build

```sh
pnpm check
pnpm build:pages
pnpm test:e2e
```

`build:pages` emits assets for `/undercooled/`. Playwright boots that production bundle through Vite Preview rather than testing the development server. The authored suite covers the four desktop teaching paths at a 1600-pixel viewport, including a sustained cooling hold.

To check an already deployed build without starting a local server:

```sh
PLAYWRIGHT_BASE_URL=https://dougathlon.github.io/undercooled/ pnpm test:e2e:built
```

Successful compilation is not treated as a substitute for the browser tests and screenshot review.

## Quantum and cooling boundary

- The public build ships labelled simulator data. It contains no QPU credential and makes no authenticated hardware request.
- Each prefetched job bundle keeps two streams separate: shot records provide `00`, `01`, `10`, or `11` canister results in the full workflow; risk records drive mapped fumbles and missed steps at persistent risk addresses.
- A measured `1` is a valid bit value, not automatically an error, failed computation, or evidence of noise.
- Heat may make a service attempt unacceptable, but it never rewrites, retries, or erases a cached measurement record.
- Cooling is a compressed, classical maintenance fiction about external refrigeration hardware. Workers do not spray the qubits or periodically recool the processor between shots. The Scene 4 `QUANTUM BLUR · SIMULATED` effect is a presentation-only thermal visualization, not a live QPU operation or a claim that blur is physical heat.
- A scene completes only after a valid measured shot is submitted and both reset controls clear the processor. A risk record is an interruption inside that service cycle, not a completed job or a measurement shot.

The intended hardware-import boundary requires a validated circuit/result fixture with per-record provenance. `SCRIPTED`, `SIMULATOR`, and `HARDWARE CACHE` must never be silently conflated.

## Project shape

```text
src/simulation/  deterministic state, jobs, layouts, manifests, and replay
src/game/        Phaser scene and presentation
src/input/       desktop keyboard input adapter
src/ui/          DOM HUD, menus, guidance, and overlays
tests/unit/      simulation contract tests
tests/e2e/       production-build browser flows and screenshots
public/assets/   optimized runtime assets
art-source/      public provenance note; raw working assets remain local
```

See [`docs/UNITY_PORT_CONTRACT.md`](docs/UNITY_PORT_CONTRACT.md) for the engine boundary and [`art-source/ART_PROVENANCE.md`](art-source/ART_PROVENANCE.md) for prototype image provenance.

## Public prototype status

This is an experimental playtest build. Timing windows, thermal bands, shot quotas, failure rates, and scoring thresholds are configurable hypotheses rather than playtest findings. Automated checks can establish deterministic behavior and interface consistency; only an unbriefed human playtest can establish whether the shared-control proposition is understood and compelling.

The public page asks search engines not to index or archive it, but GitHub Pages remains publicly accessible to anyone with the URL. See [`PROTOTYPE_RIGHTS.md`](PROTOTYPE_RIGHTS.md). No open-source licence is granted for Undercooled's own material; bundled dependencies retain the terms recorded in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt).
