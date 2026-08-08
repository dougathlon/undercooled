# Undercooled — browser playtest prototype

[Undercooled](https://dougathlon.github.io/undercooled/) is a ten-level shared-control service game built around one central quantum processor and two grotesque workers operating its mirrored sides.

One input set controls both workers. They accept a circuit job, prepare both channels, install the required pulse cartridges, complete any coupled operation, run and measure repeated shots into a result canister, submit the accepted canister, and reset the processor. External refrigeration faults compete with this sequence throughout the shift.

This repository is the deterministic Phaser/TypeScript prototype. Its simulation and replay boundary is kept separate from rendering so the rules can later be ported to Unity.

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
- Three-shot tutorial quotas are gameplay objectives, not claims of statistical significance.

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
