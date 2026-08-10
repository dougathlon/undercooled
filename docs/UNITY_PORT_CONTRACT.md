# Unity port contract

The browser build is a mechanics and art-direction prototype, not the production architecture. Preserve the following boundary when moving Undercooled to Unity.

## Portable simulation

The files under `src/simulation/` are authoritative:

- `GameState` contains every logical actor, item, station, job, plant, manifest, score, and timer state.
- `dispatchCommand()` applies one discrete shared input to a snapshot of both lanes.
- `advanceSimulation()` advances held operations, deadlines, and continuous plant load.
- the current four demo levels are data configurations, not scene-specific scripts; the same boundary supports a larger authored progression;
- manifest generation and consumption are deterministic and retain provenance per record;
- presentation events report outcomes but never decide them.

A Unity implementation should reproduce this boundary with serializable C# records and a deterministic service layer. Animation, particles, sound, camera shake, tweening, and render-time interpolation read the state and event log; they never choose a fault, alter a bit pair, or finish a workflow stage.

## Replay invariant

Given the same level, manifest bundle, seed, elapsed-time steps, and timestamped command log, Unity and the browser must finish with the same:

1. worker coordinates, facing, poses, and held-item ownership;
2. item registry and installed or dropped locations;
3. current job, loaded pulse order, shot ledger, and processor stage;
4. risk and shot stream cursors with their per-record provenance;
5. accepted paired-job count, recovery outcomes, and thermal state;
6. event sequence.

The portable format is `undercooled-state-v2`; recorded input logs use `undercooled-replay-v2`.

## Mirrored command grammar

Both rooms use the same local five-by-four grid. Local `x` increases toward the central processor in both lanes, although screen-space directions are mirrored.

- `IN`: A moves screen-right and B moves screen-left.
- `OUT`: A moves screen-left and B moves screen-right.
- `UP` and `DOWN`: both move in the same screen direction.
- one contextual action is evaluated independently on both sides from the same pre-command snapshot.
- facing updates even when a boundary turns movement into a local collision no-op.
- one worker may operate or recover while the other performs a different valid contextual action.

Corresponding simultaneous risk activations consume one joint record and apply its A/B fields atomically. A typed address consumes only on an eligible discrete interaction or legal movement attempt. Standing on a risk tile, holding a cooling tool, rendering frames, and wholly ineligible inputs consume nothing.

## Job state machine

The repeated service cycle is:

`Accept → Prepare → Load → Couple (when required) → Attach canister → Run / Measure repeatedly → Submit → Reset`

- The qubits remain inside the central processor.
- H, X, and phase cartridges are portable classical pulse-program tokens, installed in the displayed order and retained for all shots in that job.
- Coupled gates use two carried halves and a paired timing action.
- Every run consumes one immutable `ShotRecord`, exposing `00`, `01`, `10`, or `11`.
- The canister collects the configured accepted-shot quota; the v0.4 presentation demo uses one shot per job as a pacing compression, while the architecture supports repeated shots without reloading the circuit.
- The score increments only when a whole paired service job is accepted, never for an individual shot.
- A thermally invalid service attempt may reject a shot but must still log its original cached bits.
- Reset clears the service configuration and starts the next authored job. Per-shot physical reinitialization is compressed into the automatic run sequence.

## Two-stream manifest adapter

Hardware access stays outside the frame loop. A validated prefetched bundle contains two different record types:

```text
ShotRecord: job id, sample index, bits [A, B], circuit id, source, measured timestamp
RiskRecord: address, trigger type, sample index, bits [A, B], derivation, circuit id, source, measured timestamp
```

`ShotRecord` values are visible computation outputs. `RiskRecord` values are deliberately mapped onto handling or movement faults. Neither a measured `1` nor a mapped fumble is automatically evidence of hardware noise or an incorrect computation.

If a hardware stream is unavailable or depleted, the adapter may append deterministic simulator reserve records, but each consumed value must retain its actual `SIMULATOR` provenance. Never request a live result while resolving player input.

## Cooling boundary

Cooling is a continuous, classical service simulation of external refrigeration infrastructure.

- A carryable cryogenic lance occupies a worker's hands and cools only an exterior manifold intersected by its held spray ray.
- Coolant cells replenish an external service reservoir.
- Pump restart and line-clearing actions restore refrigeration capacity.
- Workload raises an abstract plant-load meter; warning bands narrow service margin and critical load can shut down the shift.
- Cooling must never consume, mutate, retry, or erase either manifest stream.

The lance is a comic compression of external maintenance, not a literal way to cool qubits or an operating cryostat. Do not aim it into the processor interior in production art.

## Presentation boundary

The selected visual target is an original porcelain-and-copper quantum service workshop: warm ivory enamel and burnished brass architecture, restrained cyan refrigeration light, blue/red lane identity, oversized verb-specific fixtures, portable service objects, and the cleaner Option 2 blue/red worker pair. The workers retain distinct silhouettes and comic physicality without the visual noise of the earlier grotesque pressure-worker pass. The 1600×900 browser plate supplies architecture only. Unity production art should split the rear shell, pale movement floor, station bodies, foreground counter occluders, emissive masks, fixtures, objects, and effects for reliable depth sorting.

Ornament, reflections, heat shimmer, and organic machine motion may be unstable. Collision geometry, station highlights, item ownership, recovery countdowns, hot-zone targeting, and provenance displays must remain exact and readable.

## v0.4 demonstration progression

Unity should preserve the current teaching order even if level length or content later changes:

1. hidden second channel with deterministic H/H service;
2. second-worker reveal with deterministic, asymmetric H/X tasks;
3. protected A side with a provenance-labelled scripted B drop followed by prefetched simulator risk, recovery, and deterministic resynchronization;
4. full joint risk in which cached records may affect A, B, or both, combined with a coupled operation and continuous cooling pressure.

The first three levels form the concise audience-facing explanation. The fourth is explicitly a later-game pressure sample. Scripted, simulator, and hardware-cache records must retain distinct provenance in any port.
