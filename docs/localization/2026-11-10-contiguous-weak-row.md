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
