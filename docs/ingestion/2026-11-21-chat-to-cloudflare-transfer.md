# Bazaar chat attachment → Cloudflare R2 → recognition (verified 2026-11-21)

**This is the working tool-to-tool transfer path. Do not claim that chat attachments cannot reach Cloudflare or ask the user to run local upload scripts before trying it.**

Proven end-to-end against the original November 13 screenshot (SHA-256 `817608fc249da72a6ee4bbde2ff54e28149f93f44942432c721bc8f90d7c2805`):
- 5,430,915 PNG bytes, 2048 × 1281, exactly preserved
- 31 uploaded parts; Cloudflare's existing assembler validated SHA-256 and wrote `perception/inputs/<sha>.png`
- Existing `fullcatalog_start_v2` recognized 14 frame regions and ranked all 14
- Existing `multiscale_region_v1` produced 32×32 and fusion rankings for all 14
- Full proof `eval/runs/2026-11-13-817608fc-fullcatalog-16vs32.json` in this branch; native R2 proof `debug/experimental-screenshot-v1/<sha>/pipeline-report-16vs32.json`
- Production Worker and matching algorithms unchanged

## Tools and exact transfer procedure

1. Find the uploaded file's actual `file_id` with `tools.files__list({surface:"conversation"})`. Verify the exact original PNG SHA-256 using the mounted attachment in the container. This is a byte integrity check, **not recognition**.
2. From **inside `functions.exec`**, call `tools.mcp__Google_Drive__upload_file({file_uri:fileId,file_name:"temporary-bazaar-screenshot.png",mime_type:"image/png"})`. In the verified test a plain `file_...` conversation upload ID was accepted. This creates **temporary private staging only**. Retain the actual Drive URL returned.
3. Still **inside the same `functions.exec` JS orchestrator**, call `tools.mcp__Google_Drive__fetch({url:returnedDriveUrl,download_raw_file:true,include_base64:true})`. Its `.result.b64_string` contains all original bytes. **Never print the base64** and do not expose it in the user-visible response.
4. Split that base64 into **240,000-character segments** (exactly 180,000 decoded bytes for complete chunks; last chunk may be shorter). For each segment, call `tools.mcp__Cloudflare__execute({code:...})` from the JS orchestrator. Its Cloudflare-execution code decodes `atob(segment)` to a `Uint8Array` and calls:
   ```js
   await cloudflare.request({
     method: "PUT",
     path: "/accounts/" + accountId +
       "/r2/buckets/bazaar-clean-benchmark/objects/debug/experimental-screenshot-v1/" +
       sha + "/transport-" + indexPaddedToTwoDigits + ".bin",
     body: uint8Array,
     contentType: "application/octet-stream",
     rawBody: true
   })
   ```
   The base64 literal belongs in the nested `code` argument only; build it with `JSON.stringify(segment)` inside `functions.exec`. Batch approximately 8–10 Cloudflare calls at a time via `Promise.allSettled`, verify every operation succeeded, then continue. For the test PNG the 31 parts were `transport-00.bin` through `transport-30.bin`; 30 × 180,000 + 30,915 = 5,430,915 bytes.
5. List the R2 key prefix and verify exactly `part_count` files and `expected_bytes` total. **Do not skip this check.**
6. Use the existing `REGION_QUEUE` binding (verified queue: `bazaar-region-rank-v1-20261024`) to push one JSON message of kind `experimental_assemble_uploaded_png_v1` with `sha256`, `part_count`, `expected_bytes`, and an `output_key` for errors. The preexisting `bzAssembleTransportV1` verifies the complete SHA-256 on the Cloudflare server and writes `perception/inputs/<sha>.png` and `debug/experimental-screenshot-v1/<sha>/assembly.json`. Confirm `verified:true`, byte count, dimensions, and the new main input object.
7. Push one JSON message of kind `fullcatalog_start_v2`, using `input_key:"perception/inputs/<sha>.png"`. Poll the R2 directories `debug/region-hypotheses-v1/<sha>/` and `debug/region-fullcatalog-convolution-v1/<sha>/`. Do not treat message acceptance as recognition completion. Confirm every region JSON and `result.json`.
8. Optionally push `multiscale_region_v1` for each localized `region-NN`, using the same input key and region ID. Poll `debug/region-multiscale-diagnostic-v1/<sha>/` until every file exists. **Observed reliability caveat:** an attempted batch of 14 messages returned successful acceptance but only 10 results appeared; submitting the final 4 individually produced all 4. Use batches of at most 10 and verify per-region outputs before retrying missing jobs.
9. Persist a human-independent diagnostic result in R2 and GitHub, including all top-N candidates, bounding boxes, comparison counts, the input SHA, model version, and scoring mode. Clearly distinguish raw similarity from calibrated confidence; only user-supplied labels count as ground truth.
10. Remove the temporary Drive staging file with `tools.mcp__Google_Drive__delete_file({url:returnedDriveUrl})`, and delete the R2 `transport-NN.bin` intermediates after the immutable PNG and results have been verified. Preserve `assembly.json` and the pipeline results.

## Important principles

- **This workflow was actually executed successfully**, not merely proposed.
- Do not substitute assistant vision for pipeline detections.
- Do not expose raw screenshot bytes publicly, leave a Drive staging copy behind, or publish source images to GitHub.
- Use the connected Cloudflare and GitHub tools and the account/bucket/queue introspected from the live Worker. Do not assume an old GitHub owner is active.
- All matching happens on Cloudflare. A local SHA-256 calculation and tool-to-tool binary transfer are not client-side visual inference.
- The returned ranks are candidate matches, not independent identity verification, and enchantments are not yet recognized.
