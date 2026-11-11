# Contiguous weak-edge row recovery — 2026-11-10

## Scope
Localization only. Preserve the existing full-catalogue convolution/PDE matcher and 16×16/32×32 scoring unchanged. This experiment is on its own Git branch; neither the live proof Worker nor production has been redeployed.

## Evidence
On screenshot SHA `9e2daed87a127f56896868f72a10382d7c0d2306beaadd4845e6fce1ef68b773`, the authoritative `frame-family-consistency-v2` localizer accepted 3 regions in the first row and rejected 2 adjacent lower-row crops solely because `edge_votes = 6.317` was below `max(7, 0.25 * 22.408) = 7`.

The lower row has the same 297px frame height as the accepted row and consecutive border coordinates `817, 1117, 1412`. Its two art-interior boxes are `(824,750,286,282)` and `(1124,750,281,282)`.

Historical screenshots also contain bottom-UI pairs that must not be admitted as cards. Unlike the new screenshot, these false pairs are widely separated: `b51793f7`: x=361 and 1697; `bcc15c62`: x=392 and 1706; `cd3fa35a`: x=380 and 1661.

## Candidate rule

A two-region band may recover from insufficient edge votes only when it:
- belongs to the same card-frame height family as the dominant row;
- has 3+ detected frame edges, sharing the middle edge between both candidate rectangles;
- contains two adjacent art interiors of comparable width and a small intervening frame gap;
- retains a minimum absolute and anchor-relative edge-support score.

The preexisting acceptance rule remains unchanged for all other rows. Recovery is explicitly labelled `contiguous_weak_row_v1` in localization diagnostics.

## Tests

- Exact committed candidate implementation evaluated against all 13 rejected-band records for 6 real screenshots stored under `debug/region-hypotheses-v1/<sha>/regions.json` in Cloudflare R2.
- Expected newly recovered regions: **2** on `9e2daed8` (proposed localization rises **3→5**).
- Other historical rejected rows newly accepted: **0**.
- Existing accepted rows are unaffected by the new predicate.
- Seven committed unit-test cases pass, including negatives for separated UI spans, incompatible frame height, and inadequate edge votes.
- The new lower-row identities have not yet been ranked by the deployed matcher and are not human-confirmed gold.
- These are *diagnostic replay tests*, not a fresh image-byte inference run of the changed Worker; deployment and end-to-end comparison remain pending.

## Files

- `src/recognition/region-hypotheses-v1.js`
- `tests/recognition/contiguous-weak-row-v1.test.cjs`

## Deploy gate

Before changing the live experimental proof Worker, deploy the updated source to an isolated candidate Worker and run the same screenshot through its **full pixel localization**. Verify the two extra crops then feed them into the unchanged 16×16/32×32 matcher. Run independent holdouts and confirm HUD negatives remain excluded. Do not modify production or frozen benchmark labels.


## New screenshot test — November 10, 2026

Screenshot SHA: `e0a2e751c304e73942580a6b44ec8427b7c331133a6487dd4f2f640f2593b0d8` (2048×1369; exact original PNG = 5,370,912 bytes).

Baseline full-catalogue pipeline accepted only 3 upper-row regions. Its native repeated-frame detector also produced three lower-row *candidates*, but rejected the entire row for low edge votes (`5.294`). Two are adjacent and similarly sized; a third, 464px-wide candidate was unsupported by the contiguous-width geometry and excluded.

The revised `bzContiguousWeakSubrowV2` rule selects the compatible **two-candidate subrow**, not the full rejected band. Bounding boxes are **programmatically derived from the original detector diagnostics**, with no labels, manual coordinates, or special screenshot IDs used in inference.

- `region-04`: `(830,754,301,279)`
- `region-05`: `(1145,754,276,279)`
- Discarded: `(1435,754,464,279)`.

A **Cloudflare R2 diagnostic replay** temporarily installed five candidate regions for this *new screenshot only*, ran the **unchanged original full-catalogue convolution matcher** and the **unchanged 32×32 multiscale matcher**, then restored the baseline localization/ranking objects. This is **not** a new Worker deployment or an integrated deployment test.

| Region | Top-1 candidate | 16×16 | 32×32 |
|---|---|---:|---:|
| Upper 1 | Bandages | 0.801232 | 0.874186 |
| Upper 2 | Piggles Protectors | 0.800430 | 0.879200 |
| Upper 3 | Steam Ladle | 0.758667 | 0.850948 |
| Lower 1 | Money Furnace | 0.822676 | 0.884174 |
| Lower 2 | ATM | 0.767642 | 0.837856 |

Top-1 identity agrees at 16×16 and 32×32 on **all five** regions. Similarity scores are not probabilities, and user-confirmed ground truth has not yet been provided.

Cloudflare evidence persisted:

`debug/localization-replay-v2/e0a2e751c304e73942580a6b44ec8427b7c331133a6487dd4f2f640f2593b0d8/replay-summary.json`

A replay of the committed recovery predicate against **16 rejected bands across seven real screenshots** yielded exactly the two intended two-region recoveries (`9e2daed8` and `e0a2e751`) and no other recovered regions. Nine focused tests passed.

**Deployment gate remains:** validate pixel-to-output inference of the committed code in an isolated Worker before considering changes to the current proof Worker. Leave production, identity-matcher source, and frozen benchmarks unchanged.
