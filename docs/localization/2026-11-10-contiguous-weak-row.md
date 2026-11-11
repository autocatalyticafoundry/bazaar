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


## Independent screenshot, November 11, 2026 — interrupted narrow frame

Screenshot SHA \`b9c4ce8c9d7850ea286e0845006c4ebe513373e2be6363b7f959925f98fabdd9\`; exact input PNG 5,933,674 bytes, 2048×1408.

Baseline Cloudflare \`fullcatalog_start_v2\` produced **8 localized card regions**: upper 3, lower 5. Both rows were already accepted. The lower band, y=717, contained boundaries x=463,626,701,791,968,1132,1462,1795. Because 626→701 was 75px and 701→791 was 90px, both were below the ordinary \`minSpan ≈ 100px\` gate; neither became a card crop. The intermediate edge at x=701 had mass 305, much weaker than its bordering edges (mass 1428 and 1099).

A geometry-only recovery rule, \`bzInterruptedFrameBridgesV1\`, checks whether two undersized spans can be joined between directly adjacent *already-accepted* card borders, with comparable neighboring widths and a substantially weaker internal edge. It recovered exactly one 165px frame, producing art-interior bbox \`(633,725,151,298)\` as \`region-09\`. Gray-level variance 50.23 and local edge contrast 21.51 both pass the original texture checks. Replaying committed bridge logic against **8 stored screenshots** produced only this single additional bridge.

Isolated R2 diagnostic replay briefly added that ninth candidate to the screenshot's R2 localization artifact, ran unchanged \`fullconv_region_v1\` and unchanged \`multiscale_region_v1\` for it, verified the full nine-region aggregate, archived outputs, and restored the baseline eight-region localization and ranking objects. **The new localization source has not been deployed.**

Region order below is spatial (upper left→right, then lower left→right); R2 IDs for lower regions retain previous baseline IDs.

| Position | R2 ID | 16×16 top1 | 32×32 top1 | Fusion top1 |
|---|---|---|---|---|
| Upper 1 | region-01 | Pop Snappers | Pop Snappers | Pop Snappers |
| Upper 2 | region-02 | Trojan | Fairy Circle | Trojan |
| Upper 3 | region-03 | Abacus | Abacus | Abacus |
| Lower 1 | region-04 | Junkyard Lance | Skyscraper | Skyscraper |
| Lower 2 | region-09 | Scythe | Critical Core | Scythe |
| Lower 3 | region-05 | Leather Jacket | Wrecking Ball | Leather Jacket |
| Lower 4 | region-06 | Char Cole | Char Cole | Char Cole |
| Lower 5 | region-07 | Critical Core | The Core | The Core |
| Lower 6 | region-08 | Candles | Candles | Candles |

**4/9 top1 16×16/32×32 agree**. Do not treat those as correct identities without user confirmation; similarities are uncalibrated and low/ambiguous for several cards.

R2 proof:
\`debug/localization-replay-v3/b9c4ce8c9d7850ea286e0845006c4ebe513373e2be6363b7f959925f98fabdd9/replay-summary.json\`.

Previous November 10 screenshot's **five identities have now been explicitly confirmed by the user**, preserved at \`tests/fixtures/user-confirmed-20261110-e0a2e751-five.json\` on this branch. This independently establishes a 5/5 confirmed result for that previous screenshot's *diagnostic-replay candidates*, but not generalized accuracy.

Both current localization improvements and tests remain on the isolated branch. Fifteen targeted tests passed. Production, frozen benchmarks, full-catalogue scorer and deployed proof Worker remain unchanged.

Next work: obtain ground-truth corrections for this new screenshot; classify localization vs candidate-retrieval vs ranking errors. Consider isolated Worker deployment only after regression and HUD false-positive checks.
