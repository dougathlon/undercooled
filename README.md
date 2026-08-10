# Undercooled — browser playtest prototype

[Undercooled](https://dougathlon.github.io/undercooled/) is a shared-control service game built around one central quantum processor and two workers operating its mirrored sides. The public link serves the v0.4 four-level Moth Quantum playtest; the earlier v0.2 build remains recoverable at tag `v0.2.0-playtest.1`.

One input set controls both workers. They accept a circuit job, prepare both channels, install the required pulse cartridges, complete any coupled operation, run and measure shots into a result canister, submit the accepted canister, and reset the processor. External refrigeration faults compete with this sequence throughout the shift. The v0.4 demo compresses each job to one accepted shot so its reveal-and-fault arc can fit a short presentation; the simulation still supports repeated-shot quotas.

This repository is the deterministic Phaser/TypeScript prototype. Its simulation and replay boundary is kept separate from rendering so the rules can later be ported to Unity.

The v0.4 presentation preserves the bright porcelain-and-copper service workshop, blue and red mirrored lane identities, physically distinct stations, and portable service objects. It replaces the busier v0.3 pressure workers with the selected cleaner Option 2 pair: a lanky blue worker in a red cap and a round red coworker. The pale floor carries only movement and risk information; the dark teal HUD carries job and provenance information.

## Four-level demo arc

Each level asks for one complete accepted service cycle, including reset:

1. **Solo Service:** one worker is visible, but the occluded second channel already receives every mirrored command; the H/H job is deterministic.
2. **The Other Pair:** the second worker is revealed, and the deterministic H/X job establishes that shared movement can produce different contextual work on each side.
3. **Protected Risk:** Channel A remains protected while a clearly labelled scripted record demonstrates a Channel B cartridge drop; subsequent prefetched simulator records can also make B miss a transfer step. Recovery and the stopping rail make offset legible rather than terminal.
4. **Joint Risk:** neither side is protected. Coupling, A/B/bilateral faults, expiring drops, transfer misses, and rising thermal load provide a busier later-game example if presentation time permits.

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
- `Space` / `E`: contextual action; hold to sustain preparation, coupling, machine controls, or a carried cryogenic lance
- `Escape` / `P`: pause
- `R`: restart the active shift
- Phone or tablet: use the labelled `IN`, `OUT`, `UP`, and `DOWN` controls in landscape orientation

## Verify the release build

```sh
pnpm check
pnpm build:pages
pnpm test:e2e
```

`build:pages` emits assets for `/undercooled/`. Playwright boots that production bundle through Vite Preview rather than testing the development server. It covers Chromium at a 1600-pixel desktop viewport and a touch-enabled Pixel 7 landscape viewport.

To check an already deployed build without starting a local server:

```sh
PLAYWRIGHT_BASE_URL=https://dougathlon.github.io/undercooled/ pnpm test:e2e:built
```

Successful compilation is not treated as a substitute for the browser tests and screenshot review.

## Quantum and cooling boundary

- The public build ships labelled simulator data. It contains no QPU credential and makes no authenticated hardware request.
- Each prefetched job bundle keeps two streams separate: shot records provide the visible `00`, `01`, `10`, or `11` canister results; risk records drive mapped fumbles and missed steps at persistent risk addresses.
- A measured `1` is a valid bit value, not automatically an error, failed computation, or evidence of noise.
- Heat may make a service attempt unacceptable, but it never rewrites, retries, or erases a cached measurement record.
- Cooling is a compressed, classical maintenance fiction about external refrigeration hardware. Workers do not spray the qubits or periodically recool the processor between shots.
- The current one-shot job quotas are presentation compression, not claims of statistical significance. The architecture can still collect a configured number of repeated shots before submission.

The intended hardware-import boundary requires a validated circuit/result fixture with per-record provenance. `SCRIPTED`, `SIMULATOR`, and `HARDWARE CACHE` must never be silently conflated.

## Project shape

```text
src/simulation/  deterministic state, jobs, layouts, manifests, and replay
src/game/        Phaser scene and presentation
src/input/       keyboard and touch input adapter
src/ui/          DOM HUD, menus, overlays, and mobile controls
tests/unit/      simulation contract tests
tests/e2e/       production-build browser flows and screenshots
public/assets/   optimized runtime assets
art-source/      public provenance note; raw working assets remain local
```

See [`docs/UNITY_PORT_CONTRACT.md`](docs/UNITY_PORT_CONTRACT.md) for the engine boundary and [`art-source/ART_PROVENANCE.md`](art-source/ART_PROVENANCE.md) for prototype image provenance.

## Public prototype status

This is an experimental playtest build. Timing windows, thermal bands, shot quotas, failure rates, and scoring thresholds are configurable hypotheses rather than playtest findings.

The public page asks search engines not to index or archive it, but GitHub Pages remains publicly accessible to anyone with the URL. See [`PROTOTYPE_RIGHTS.md`](PROTOTYPE_RIGHTS.md). No open-source licence is granted for Undercooled's own material; bundled dependencies retain the terms recorded in [`public/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt).
