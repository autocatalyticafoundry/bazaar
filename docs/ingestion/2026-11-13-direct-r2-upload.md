# Exact-byte Bazaar screenshot intake (isolated)

This fixes the *transport* path: send the original PNG to Cloudflare R2 and ask the deployed Bazaar Queue consumer to run the unchanged server-side full-catalogue recognizer. **No visual matching or recognition takes place in the uploader.**

The source image is stored as `perception/inputs/<SHA256>.png`. Only the experimental `fullcatalog_start_v2` job is sent; no production promotion, benchmark label changes, or algorithm changes occur.

## Requirements

- Python 3.9+ with standard library only
- Network access to `https://api.cloudflare.com`
- Cloudflare API token scoped to the account containing Bazaar, with permissions to write/read R2 objects and push Queue messages
- Account ID for that Cloudflare account

Do not put API tokens in source code or in the GitHub repository.

## Usage

```bash
export CLOUDFLARE_ACCOUNT_ID="<your-active-Cloudflare-account-id>"
export CLOUDFLARE_API_TOKEN="<Cloudflare-API-token>"

python3 scripts/submit_screenshot.py /path/to/screenshot.png
```

To verify an image *without network access or changes*:

```bash
python3 scripts/submit_screenshot.py /path/to/screenshot.png --prepare-only
```

The default discovery name `bazaar-region-rank-v1-20261024` was checked against the existing experimental Worker's `REGION_QUEUE` binding on 2026-11-13. If the account or queue changes, supply `--queue-name` or `--account` explicitly.

The command polls for the existing region-localization and full-catalogue ranking artifacts and prints JSON containing bounding boxes, top-three canonical entity IDs, and **uncalibrated** similarity scores. A polling timeout is not proof that recognition failed: check the Worker/Queue logs and retry reading the immutable SHA-specific R2 keys.

## November 13 screenshot intake fixture

- Original PNG SHA-256: `817608fc249da72a6ee4bbde2ff54e28149f93f44942432c721bc8f90d7c2805`
- Image dimensions: 2048 × 1281
- Bytes: 5,430,915
- Intended R2 key: `perception/inputs/817608fc249da72a6ee4bbde2ff54e28149f93f44942432c721bc8f90d7c2805.png`

**Status:** The hash and format were validated locally. The image is **not yet uploaded to R2**. This ChatGPT container does not have outbound network access to send raw bytes; the connected Cloudflare management tool does not accept attached file bytes as an input. Use the uploader from a network-enabled environment.

## Tests

```bash
python3 -m unittest discover -s tests/ingestion -p 'test_*.py' -v
```
