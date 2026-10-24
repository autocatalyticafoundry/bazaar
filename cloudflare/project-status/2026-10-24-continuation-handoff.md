# Bazaar — Development Handoff

**As of:** 24 October 2026  
**Authoritative software checkpoint:** `development v8`  
**Purpose:** Carry Bazaar development into a new conversation without losing the exact goals, experimental infrastructure, test evidence, or outstanding failures.

> **Read this first:** Bazaar has a genuine **10/10 human-confirmed top-1 recognition result** for one 10-card screenshot using its full-catalogue convolution/PDE matcher. The improvement over older stages is **4/10 → 7/10 → 10/10**. However, an independent screenshot is known to contain **11 playable cards** and the program currently produces **10 candidate regions**, of which only **Stained Glass Window** has independently confirmed identity. Do **not** claim general 100% accuracy or that the 11-card screenshot is fully solved. Work in the canonical repo, on the experimental worker, and keep production unchanged.

## 1. Project goal and hard constraints

**Ultimate goal:** Given an arbitrary *The Bazaar* in-game screenshot, automatically produce trustworthy, structured game state:

**pixels → located game objects → canonical entity identities → actual game metadata/effects + visible per-instance state**

Target concepts include playable items/cards, heroes, encounters, merchants, trainers, events, actions, upgrades, enchantments, scene context, HUD numbers, item positioning and overlaps. A recognized visual asset is not yet the finished object: the end product must include the real canonical game entity and what it does, with visible upgrades or instance-specific values extracted when possible.

**Non-negotiable requirements:**

- Recognition is **programmatic, server-side only**. Do not use the assistant’s own image vision as the pipeline, or manually hard-code the identities or boxes of benchmark screenshots.
- Infrastructure and inference must stay **within free service limits**. No paid image-inference API, paid cloud GPU, or client-side recognition.
- Process real screenshot PNG bytes, preserve hashes, use a canonical image/art corpus. Do not reconstruct uploaded screenshots from human prose.
- Report candidate guesses when useful but **distinguish** rank/similarity from accepted geometry and from independently verified truth. Similarity scores, including numbers around 0.8, are **not calibrated probabilities**.
- Maintain regression integrity: do not let HUD/day-hour counters become playable cards; **Hands of Time is NOT present** in the old 11-card screenshot. Maintain the confirmed **Stained Glass Window** match.
- Use version control, keep canonical source in the correct GitHub repository, persist reproducible tests/artifacts to GitHub and R2, and do not mutate production without independent evidence.
- When told “Continue,” **implement and test**, rather than merely outlining plans. Prefer plain-English, evidence-based status reports.

## 2. Canonical source of truth / accounts

**Only canonical repository:** [`autocatalyticafoundry/bazaar`](https://github.com/autocatalyticafoundry/bazaar). Do not use the obsolete `allaboutstudios/bazaar` or `heavymediumtool/bazaar` paths.

- Main branch: authoritative status and source backups, stored under `cloudflare/`.
- Current active experimental code branch: [`experiment/dense-rarity-20261023`](https://github.com/autocatalyticafoundry/bazaar/tree/experiment/dense-rarity-20261023).
- **Latest machine status on main:** [`cloudflare/project-status/latest.json`](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/latest.json).
- **Latest verified detailed checkpoint:** [`cloudflare/project-status/2026-10-24-development-v8.json`](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/2026-10-24-development-v8.json); mirrored in R2 as `debug/project-status/2026-10-24-development-v8.json`.
- R2 status mirror: `debug/project-status/latest.json` in bucket `bazaar-clean-benchmark`. As of the handoff, R2 and main were verified to contain the same v8 status timestamp (`2026-10-24T21:51:55.833Z`).
- Full-proof Worker source snapshot on the branch: `cloudflare/workers/bazaar-whole-screen-fingerprint-proof-20261009/content-v2.multipart` (multipart module source).

**Cloudflare:**

| Resource | Name / identifier | Operational policy |
|---|---|---|
| Production Worker | `bazaar-clean-benchmark` | **Do not touch.** Preserved deployment `448be080-f7b0-47a0-8a4c-34dcc019d389`. |
| Experimental proof Worker | `bazaar-whole-screen-fingerprint-proof-20261009` | Latest v8 deployed ID **`ce6737d0c00e48c79ae32bf3d4dfd0bf`**. This is where recognition work happens. |
| Main experiment queue | `bazaar-fullgeo-v1-20261014`, ID `9ad127b9abbf45a4af8a0bc44df14b66` | Legacy/geometry workloads; do not overload. |
| Region ranking queue | `bazaar-region-rank-v1-20261024`, ID `8d3a1e478c4c4eb186b8ae8ad0f4e7a9` | Queue for region/full-catalogue jobs. |
| R2 bucket | `bazaar-clean-benchmark` | Canonical screenshot PNGs, corpus, indexes, proof and evaluation artifacts. |

The code is connected through the Cloudflare and GitHub apps; use their live tools to inspect and mutate these resources. Do not paste secrets, hard-code tokens, or assume older backup deployment IDs remain active.

## 3. Current recognition architecture

There are two complementary experimental pathways. **Prefer the newer region-first full-catalogue pathway for identifying cards**; preserve the older geometry verifier as a distinct trust signal.

### 3.1 Region-first full-catalogue pathway — best measured results

1. **Ingestion:** screenshot PNG placed into R2 at `perception/inputs/<SHA-256>.png`, with exact-byte identity.
2. **Card localization:** server-side repeated-frame-boundary and texture analysis on native pixels. Stores independent bounding boxes in `debug/region-hypotheses-v1/<sha>/regions.json`. No manual screenshot coordinates in runtime.
3. **Full-catalogue cheap search:** for **each detected region**, compare a 4×4 color representation to **all 1,483 reference images**. This step matters because the earlier BRIEF shortlist excluded many true cards.
4. **Bounded detailed reranking:** take about 48 strongest coarse candidates, plus non-duplicate candidates from the older region shortlist when present (typically **48–54 candidates per card**). At 16×16 resolution, apply separable Gaussian convolution, oriented-gradient/HOG features, chroma comparison and nonlinear anisotropic diffusion (PDE/Perona–Malik style). Compare center-cropped and nonuniform-stretch variants. Rank by raw image-similarity score.
5. **Results:** per-region top-N guesses and similarity scores are saved in R2. They are **candidate identities**, not calibrated probabilities or inherently accepted geometric matches. The system can separately attach independent geometry evidence.
6. **Post-inference evaluation:** an evaluator loads ground-truth labels **only after** predictions exist, preventing label leakage into scoring.

**Cost/performance evidence:** on the 10-card screenshot the last full run made **14,830 coarse comparisons** and **532 detailed convolution/PDE comparisons**, covering 10 regions and 1,483 reference visuals. This is not 1,483 expensive full-resolution comparisons per region. The reranker uses small grids to meet free server-side budgets.

### 3.2 Older native-feature and geometric verifier

A complete **v3 128-distinct-bit BRIEF** canonical local fingerprint bank exists. Earlier v1 inadvertently repeated just 17 unique comparisons across the supposed 128 bits; that flaw was repaired. All **1,483/1,483 canonical reference visuals** are indexed after repairing 26 missing normalized references. Bank and packed index are stored as eight shards:

- `debug/whole-screen-local-feature-bank-v3/bank.json`
- `debug/whole-screen-local-feature-bank-v3/shards/shard-00.json` through `shard-07.json`
- `debug/global-local-packed-index-v3/shard-00.bin` through `shard-07.bin`

This pathway extracts native-resolution target features; uses rarity weighting, shortlist and geometric transforms/RANSAC, and dedupes accepted detections. It conservatively verified **Regal Blade** and **Golf Clubs** on the 10-card screenshot, and **Stained Glass Window** on the earlier 11-card screenshot. Its recognition recall is much lower than the new full-catalogue ranking; do not confuse rejected RANSAC matches with incorrect top-1 ranking or claim all convolution top-1 results passed geometry.

## 4. Human-confirmed 10-card fixture — decisive positive result

**Screenshot SHA-256:** `cd3fa35a00ba9d021c75575d4a8642584284051e479324c2853b51134d88a09a`  
**Screenshot dimensions:** 2048 × 1338  
**R2 PNG:** `perception/inputs/cd3fa35a00ba9d021c75575d4a8642584284051e479324c2853b51134d88a09a.png`

The user explicitly confirmed: **“The cards you just returned are ALL correct.”** That statement refers to the following full-catalogue top-1 sequence. Left-to-right within each row:

| Region | Row / place | Correct canonical card | Programmatic box (x,y,w,h) | Full-catalogue similarity |
|---|---|---|---|---:|
| region-01 | Upper 1 | Regal Blade (`RegalBlade`) | (714,399,288,280) | 0.841170 |
| region-02 | Upper 2 | Money Furnace (`MoneyFurnace`) | (1016,399,293,280) | 0.870001 |
| region-03 | Upper 3 | Boomerang (`Boomerang`) | (1323,399,281,280) | 0.869157 |
| region-04 | Lower 1 | Brass Knuckles (`BrassKnuckles`) | (560,729,132,276) | 0.792574 |
| region-05 | Lower 2 | Tusked Helm (`TuskedHelm`) | (706,729,136,276) | 0.673858 |
| region-06 | Lower 3 | Uwashiwali Bird (`UwashiwaliBird`) | (856,729,140,276) | 0.760679 |
| region-07 | Lower 4 | Succulents (`Succulents`) | (1010,729,144,276) | 0.688343 |
| region-08 | Lower 5 | Golf Clubs (`GolfClubs`) | (1168,729,291,276) | 0.828320 |
| region-09 | Lower 6 | Pepper Spray (`PepperSpray`) | (1473,729,139,276) | 0.781189 |
| region-10 | Lower 7 | Bandages (`Bandages`) | (1626,729,134,276) | 0.795826 |

**Accuracy progression (same screenshot, top-1):**

| Stage | Correct | Wide cards | Narrow cards |
|---|---:|---:|---:|
| Original region BRIEF/rareness scorer | **4/10 (40%)** | 4/4 | 0/6 |
| Crop-aware Gaussian/PDE rerank limited to older candidates | **7/10 (70%)** | 4/4 | 3/6 |
| Full 1,483-artwork search + convolution/PDE rerank | **10/10 (100%)** | 4/4 | 6/6 |

Crucial diagnosis: **five true identities were not even present in the original top-six per-object shortlists**. This is a retrieval failure, not merely too-strict verification. The full-catalogue cheap prefilter recovered missing candidates.

**Gold and proof:**

- Human-labelled fixture: [`cloudflare/project-status/2026-10-24-gold-10-of-10-fullcatalog-confirmed.json`](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/2026-10-24-gold-10-of-10-fullcatalog-confirmed.json).
- Independent evaluator output: R2 `debug/region-fullcatalog-convolution-v1/<sha>/evaluation.json` (top-1 **10/10**, top-3 **10/10**).
- Ranked JSON: R2 `debug/region-fullcatalog-convolution-v1/<sha>/result.json`.
- Detailed historical stagewise proof: [`cloudflare/project-status/2026-10-24-fullcatalog-convolution-pde-v1.json`](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/2026-10-24-fullcatalog-convolution-pde-v1.json).
- Not a calibration study: raw image scores are **not posterior probabilities**, and the result is **one verified screenshot**, not proof of overall reliability.

## 5. Independent 11-card screenshot — not fully solved

**Screenshot SHA-256:** `5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393`  
**Dimensions:** 2048 × 1409  
**R2 PNG:** `perception/inputs/5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393.png`

Historical human observation: **11 distinct playable cards are visible**. The current repeated-boundary detector produces **10 regions**, so localization has missed at least one card. **Stained Glass Window** is confirmed as a card; its location corresponds to `region-02`. **Hands of Time is not a card**, and the time-related display is HUD/day-hour information.

The new full-catalogue routine evaluated all ten produced regions using **14,830 cheap** comparisons plus **480 detailed** reranks. These are its top-1 *hypotheses*, not nine additional confirmed cards:

| Detected region | Top-ranked visual | Raw similarity | Truth status |
|---|---|---:|---|
| region-01 | Speedrunner | 0.815227 | **Unverified** |
| region-02 | Stained Glass Window | 0.841194 | **Historically confirmed** |
| region-03 | Marbles | 0.776889 | **Unverified** |
| region-04 | Sapphire | 0.769070 | **Unverified** |
| region-05 | Battery | 0.727995 | **Unverified** |
| region-06 | The Boulder | 0.616770 | **Unverified**; runner-up 0.616255 (nearly tied) |
| region-07 | Venomander | 0.779368 | **Unverified** |
| region-08 | Flare | 0.709170 | **Unverified** |
| region-09 | Baked Potato | 0.780930 | **Unverified** |
| region-10 | Bayonet | 0.662485 | **Unverified** |

The fallback probe for isolated/discarded card-like regions surfaced **three speculative regions**, with proposed names Ulu Knife, Colossal Popsicle and Lens, but **accepted none**. Three similarly speculative regions were also found on the confirmed screenshot; none was accepted. Do not claim these correspond to a missing playable card. They may be HUD or non-cards.

Relevant R2:

- `debug/region-hypotheses-v1/<old-sha>/regions.json` — 10 programmatic bounding boxes and border/row diagnostics.
- `debug/region-fullcatalog-convolution-v1/<old-sha>/result.json` — all ten regions and top candidates.
- `debug/region-fullcatalog-convolution-v1/<old-sha>/status-snapshot.json` — confirmed complete processing of all **10 proposals**.
- `debug/region-fallback-v1/<old-sha>/result.json` — diagnostic-only fallback, **0 accepted**.

**DO NOT conflate** 10/10 ranked *regions* with 10/11 correct *identities*. One is definitely a localization miss; only one of the ten identities on this old screenshot has known truth.

## 6. Current modules, routes, and job orchestration

**GitHub experiment branch source** (all paths relative to repository root):

- `src/recognition/fullcatalog-convolution-v1.js`: 1,483-reference 4×4 color coarse search; bounded 16×16 convolution/PDE/chroma/HOG detailed candidate ranking; writes per-card R2 JSON and aggregate.
- `src/recognition/convolution-affine-pde-v1.js`: separable Gaussian, anisotropic diffusion, crop/cover versus stretch, HOG and color comparisons.
- `src/recognition/region-hypotheses-v1.js`: native-resolution repeated-frame-edge locator, per-object candidate identity rankings and boxes.
- `src/recognition/fullcatalog-workflow-v2.js`: **default experimental** idempotent orchestration, reuse-completed semantics, per-region status; jobs `fullcatalog_start_v2` and `fullcatalog_status_v2`.
- `src/recognition/isolated-region-probe-v1.js`: rejected-row/island detector used only as a **diagnostic fallback**; no speculative cards admitted.
- `src/recognition/gold-evaluator-v1.js`: read independent gold labels after inference; post-inference top-1/top-3 scoring.
- `src/ingestion/screenshot-upload-v1.js`: experimental PNG hash verification, R2 storage, submit `fullcatalog_start_v2`, returns processing status/result, alongside older geometry jobs.
- `src/recognition/brief-128-v3.js`, `src/recognition/dense-rare-shortlist-v1.js`, `src/recognition/rarity-cache-v1.js`, `src/recognition/hough-exhaustive-reduce-v1.js`, `src/recognition/screenshot-dedupe-v1.js`: old feature/geometric path.
- `cloudflare/workers/bazaar-whole-screen-fingerprint-proof-20261009/content-v2.multipart`: live module Worker snapshot for deployment. **Keeping this synchronized with the source modules is necessary**; updating standalone source files alone does not deploy them.

**Processing contract:** `POST /api/experimental/screenshots` (PNG bytes) and `GET`/`POST /api/experimental/screenshots/{sha256}/results` are implemented on the experimental Worker, but **authentication configuration has NOT been validated end-to-end**. The upload route checks `BAZAAR_SCREENSHOT_UPLOAD_TOKEN` and intentionally fails closed when absent. Do not tell the user it works directly through the public API until a real authorized upload is successfully tested.

`fullcatalog_start_v2` is safe to enqueue again for an R2-resident image. It reuses completed region outputs and dispatches only pending regions. Verified on the older benchmark: `completed_count=10`, `queued_count=0`, `queue_state=not_required`. Results have been checked through `fullcatalog_status_v2` snapshot on both screenshots, each `ranked_count=10`.

**Queue work example:**

```js
const sha = '5a4e9b43b05b2fd6f998cf2725ac450c1dd483f58134d0dec4b4713622bfd393';
const message = {
  content_type: 'json',
  body: {
    kind: 'fullcatalog_start_v2',
    input_key: `perception/inputs/${sha}.png`,
    output_key: `debug/region-fullcatalog-convolution-v1/${sha}/error-start.json`
  }
};
// Cloudflare connector, inside mcp__Cloudflare__execute code:
await cloudflare.request({
  method: 'POST',
  path: `/accounts/${accountId}/queues/8d3a1e478c4c4eb186b8ae8ad0f4e7a9/messages`,
  body: message
});
```

To inspect results, use the Cloudflare connector `GET /accounts/${accountId}/r2/buckets/bazaar-clean-benchmark/objects/<key>` and parse JSON. Enqueuing only proves a message was accepted. **Always verify output R2 artifacts**: queue jobs can be acknowledged, retried or fail without creating the expected result file. The Worker has job `output_key` error artifacts, but missing R2 output still means incomplete work. Do not promise background delivery.

## 7. Exact latest state to trust

The most up-to-date verified checkpoint is **v8** (`cloudflare/project-status/2026-10-24-development-v8.json`) and its corresponding R2 object. It states:

- Proof Worker deployment `ce6737d0c00e48c79ae32bf3d4dfd0bf`.
- Latest automatic screenshot job: `fullcatalog_start_v2`.
- Idempotent restart and result-status snapshots verified on **two** screenshots.
- Human gold evaluator: **10/10 top-1**, **10/10 top-3** on the user-confirmed screenshot.
- Independent known-11-card screenshot: **10 localized**, **1 historically confirmed identity**, **9 identity guesses not yet validated**.
- Isolated fallback: three speculative regions; **zero accepted**.
- Production remains unchanged.
- Complete scene-to-gameplay-metadata and visible per-instance state are **not** yet implemented end-to-end.

Prior checkpoints, especially the 2026-10-23 handoff or `development v7`, are **historical and superseded** for code/runtime status. They remain useful for understanding the v3 descriptor/index repairs but are not the latest state. If later updates occur, re-fetch `latest.json`, the active Worker deployment and R2 proof before making claims.

## 8. Immediate next development tasks, in the correct order

**Task A — recover the missing eleventh card without cheating (highest priority).**

- Examine actual programmatic boundary proposals and `rejected_bands` / fallback records on the older screenshot. The current locator is biased toward rows with at least three repeated rectangles and can miss isolated, overlapping, or atypically sized cards.
- Develop a **generic** second-stage region proposal using spatial/art evidence, not a one-image hand-entered rectangle, and test it against both fixtures. Make it fail closed on HUD and other non-cards.
- Measure localization proposal recall on the 11 true playable cards (requires gold per-card boxes where available), plus false-positive proposals. Preserve 10/10 on the fully labelled fixture and Stained Glass Window on the older one.
- Do not promote weak fallback guesses (e.g., Ulu Knife / Colossal Popsicle / Lens) into accepted card IDs without evidence.

**Task B — independently validate the other nine guesses on the older screenshot.**

- The old screenshot has only Stained Glass Window confirmed. If the user confirms/corrects the nine visible-region guesses, convert that to a new gold fixture; do **not** manufacture identities from assistant vision.
- Evaluate per-object top-1/top-3, score gaps, and unknown classifications on independent screenshots. Separate localization misses, retrieval misses, ranking errors, and verification rejections.

**Task C — make convolution rankings and geometric verification cooperate.**

- The new retrieval and scores can correctly rank narrow cards that older RANSAC rejects. Develop crop-aware/affine verification with separate x/y scales or normalized card-art transformations and genuine spatial constraints.
- Maintain high precision. Evaluate geometry against explicit negative/HUD regions and against the two proven 10-card geometric identities; don't soften a verifier merely to inflate recall.

**Task D — actual canonical game-state output (the ultimate goal).**

- Join each canonical visual asset to the canonical card/entity ID and its current gameplay metadata: text/effects, cooldown, stats, size, enchantments and other source-derived facts.
- Extract visible per-instance differences from screenshots and represent relationships, positions, and overlap.
- Return a schema with `regions`, `candidate_identities`, `scores` (explicitly uncalibrated), `verified_identity`, `canonical_entity`, `game_data`, `visible_instance_state`, `scene_context` and `unrecognized_regions`. Never invent absent fields.

**Task E — operations, reliability, and safe rollout.**

- Validate a real authorized API screenshot upload and response, maintain exact PNG hash and size.
- Time/cache experiment jobs within free limits. Watch Cloudflare Queue, R2 write/operation quotas and Worker constraints; do not indiscriminately rescan full frames.
- Evaluate on more independent screenshots; only then consider changing production. Keep production Worker deployment frozen until measured generalization and false-positive behavior improve.

## 9. Known pitfalls and required response behavior

1. **10/10 is real, but only for one screenshot.** Neither all game contexts nor the unseen 11-card screenshot have been shown solved.
2. **Ranks are not probabilities.** The prior experiment’s “relative support %” was a softmax over limited candidates, not a calibrated posterior. The full-catalogue 0.8 scores are raw similarities, not 80% likelihood.
3. **A shard is only a database partition**, not a screenshot region. The user wants per-card identity candidates associated with an actual location.
4. **No assistant-image substitute.** If recognition output is missing, say so and fix the underlying pipeline; do not provide made-up labels or claim human vision is programmatic proof.
5. **Uploader auth is not confirmed.** Previous messages described a chat-to-R2 blocker which was subsequently resolved; screenshot PNGs are present in R2. Check what *currently* works rather than repeating an obsolete blocker.
6. **Current row-boundary detector is incomplete.** It misses at least one known playable card on the older 11-card screenshot; isolated fallback hypotheses have 0 accepted.
7. **No paid/client-only solution.** If proposing a new vision network, verify the inference is free and server-side, with measurement before adoption.
8. **Code and R2 are both important.** Keep branch Worker source, standalone modules, test artifacts, main status and R2 status synchronized; never claim success on a queued-but-unverified job.
9. **Give concise direct updates.** The user is pursuing working software, not general brainstorming. On “Continue development,” take actual tool actions, run tests, save checkpoints and show factual metrics.

## 10. Links to reopen in the next conversation

- [Main status](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/latest.json)
- [Authoritative development v8](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/2026-10-24-development-v8.json)
- [Gold 10-card fixture](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/2026-10-24-gold-10-of-10-fullcatalog-confirmed.json)
- [Full-catalogue convolution/PDE stage result](https://github.com/autocatalyticafoundry/bazaar/blob/main/cloudflare/project-status/2026-10-24-fullcatalog-convolution-pde-v1.json)
- [Experimental branch](https://github.com/autocatalyticafoundry/bazaar/tree/experiment/dense-rarity-20261023)
- [Full-catalogue workflow module](https://github.com/autocatalyticafoundry/bazaar/blob/experiment/dense-rarity-20261023/src/recognition/fullcatalog-workflow-v2.js)
- [Full-catalogue matcher](https://github.com/autocatalyticafoundry/bazaar/blob/experiment/dense-rarity-20261023/src/recognition/fullcatalog-convolution-v1.js)
- [Region localization](https://github.com/autocatalyticafoundry/bazaar/blob/experiment/dense-rarity-20261023/src/recognition/region-hypotheses-v1.js)
- [Isolated diagnostic region fallback](https://github.com/autocatalyticafoundry/bazaar/blob/experiment/dense-rarity-20261023/src/recognition/isolated-region-probe-v1.js)
- [Gold evaluator](https://github.com/autocatalyticafoundry/bazaar/blob/experiment/dense-rarity-20261023/src/recognition/gold-evaluator-v1.js)

### Suggested opening prompt for the new conversation

> Continue developing Bazaar using the attached 2026-10-24 handoff. First read the current `autocatalyticafoundry/bazaar` main `cloudflare/project-status/latest.json` and `2026-10-24-development-v8.json`, plus the live experimental branch and R2 results. The verified full-catalogue matcher is 10/10 on one human-confirmed screenshot; the independent screenshot has 11 playable cards but only 10 localized regions, with Stained Glass Window confirmed and nine other top guesses unverified. Prioritize **general, server-side, free localization of the missing eleventh card** without admitting HUD or speculative fallback proposals, then validate independent identity recall. Implement and test; keep production unchanged, preserve proof to GitHub + R2, and report real metrics rather than plans.

---

**Last-known outcome:** A genuine full-catalogue recognition breakthrough, not yet general reliability. The next effort should turn **10/10 identity success on one screenshot** into **high localization recall and verified semantic game-state output across arbitrary screenshots**.