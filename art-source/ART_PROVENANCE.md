# Prototype art provenance

## Runtime asset record

- `public/assets/environment/undercooled-central-workshop-v2.png` was generated with OpenAI image generation on 2026-08-08 and resized to the runtime canvas at 1600×900. The selected generation depicts two mirrored gold service workspaces, a narrow central processor, and cyan external refrigeration infrastructure. An earlier generation was rejected because it collapsed the workspaces into one central aisle. SHA-256: `976f8e05dafbb820df1bcdb9dc2d7536045e14534c304cf575733b2e58790467`.
- `art-source/archive/auric-nerveworks-v1.png` was generated with OpenAI image generation on 2026-08-06 as the original systems-spike environment. It was retired from the runtime after the v2 scene migration, remains in the local excluded source archive, and is not published. SHA-256: `c9bd491165da7743ab8667aadc039ed366becfb30e59e9bb7fadca3734544c2e`.
- The two pressure-worker pose sheets were generated with OpenAI image generation on 2026-08-06, then locally cropped, chroma-keyed, and normalized into transparent runtime frames.

The worker source sheets and review previews are retained in `art-source/characters/` but excluded from the public repository. Only optimized runtime frames and the selected environment plate ship from `public/assets/`.

The selected v2 environment prompt specified a high shallow three-quarter game camera, complete mirrored work areas on either side of a shared central processor, horizontal counters, three-cell-deep movement aprons, outer supply benches, and serviceable external cooling hardware. It explicitly excluded characters, text, UI, loose objects, logos, named properties, exposed qubits, and collision-critical indicators baked into the background.

The direction is an original grotesque industrial-fantasy setting. It uses the user's references as tonal prompts but intentionally avoids copying identifiable characters, costumes, locations, logos, or named franchise designs.

These are prototype assets. Before production use, review consistency, edge cleanup, animation requirements, and licensing or credit language appropriate to the final release pipeline. See [`PROTOTYPE_RIGHTS.md`](../PROTOTYPE_RIGHTS.md) for the public playtest rights notice.
