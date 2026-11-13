#!/usr/bin/env python3
"""Upload exact Bazaar screenshots to R2 and start the existing server-side matcher.

No image analysis runs on the uploader. Requires a Cloudflare API token authorized
for R2 Objects Edit and Queues Write in the account hosting Bazaar.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = "https://api.cloudflare.com/client/v4"
PREFIX = "debug/region-fullcatalog-convolution-v1/"


def image_info(path):
    data = Path(path).read_bytes()
    if len(data) > 10 * 1024 * 1024 or len(data) < 33:
        raise ValueError("Screenshot must be a PNG between 33 bytes and 10 MiB")
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Expected exact original PNG bytes")
    width, height = struct.unpack(">II", data[16:24])
    if width < 64 or height < 64 or width * height > 24_000_000:
        raise ValueError("Unsupported PNG dimensions")
    sha = hashlib.sha256(data).hexdigest()
    return data, sha, width, height


def call(token, method, route, body=None, content_type="application/json", missing_ok=False):
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = content_type
    req = Request(BASE + route, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read()
            if not raw:
                return {}
            doc = json.loads(raw)
            if isinstance(doc, dict) and doc.get("success") is False:
                raise RuntimeError(f"Cloudflare API error: {doc.get('errors')}")
            return doc.get("result", doc) if isinstance(doc, dict) else doc
    except HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        detail = error.read(1500).decode("utf-8", "replace")
        raise RuntimeError(f"Cloudflare API HTTP {error.code}: {detail}") from error


def object_route(account, bucket, key):
    # Cloudflare's R2 object API explicitly requires literal slashes in keys.
    return f"/accounts/{quote(account)}/r2/buckets/{quote(bucket)}/objects/{quote(key, safe='/')}"


def load_json(token, account, bucket, key):
    return call(token, "GET", object_route(account, bucket, key), missing_ok=True)


def queue_id_for_name(token, account, name):
    queues = call(token, "GET", f"/accounts/{quote(account)}/queues")
    if not isinstance(queues, list):
        raise RuntimeError("Cloudflare did not return a queue list")
    for q in queues:
        if q.get("queue_name") == name or q.get("name") == name:
            return q.get("queue_id") or q.get("id")
    raise RuntimeError(f"Queue {name!r} is not accessible in account {account}")


def enqueue_start(token, account, queue_id, key, sha):
    payload = {"content_type": "json", "body": {
        "kind": "fullcatalog_start_v2", "input_key": key,
        "output_key": PREFIX + sha + "/error-start.json"}}
    call(token, "POST", f"/accounts/{quote(account)}/queues/{quote(queue_id)}/messages",
         json.dumps(payload).encode("utf-8"))


def summarize(token, account, bucket, sha):
    base = PREFIX + sha + "/"
    regions = load_json(token, account, bucket,
                        f"debug/region-hypotheses-v1/{sha}/regions.json")
    if not isinstance(regions, dict):
        return None
    responses = []
    for reg in regions.get("regions", []):
        rid = reg["region_id"]
        item = load_json(token, account, bucket, base + rid + ".json")
        if not isinstance(item, dict):
            return {"status": "processing", "localized_regions": len(regions["regions"]),
                    "ranked_regions": len(responses)}
        responses.append({"region_id": rid, "bbox": reg.get("bbox"),
                          "candidates": [{"canonical_entity_id": r.get("canonical_entity_id"),
                                          "raw_similarity": r.get("score")}
                                         for r in item.get("top", [])[:3]]})
    if not responses:
        return {"status": "no_regions"}
    return {"status": "ranked", "localized_regions": len(responses),
            "identity_probabilities_calibrated": False, "regions": responses}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("screenshot", type=Path)
    p.add_argument("--account", default=os.getenv("CLOUDFLARE_ACCOUNT_ID"))
    p.add_argument("--bucket", default="bazaar-clean-benchmark")
    p.add_argument("--queue-name", default="bazaar-region-rank-v1-20261024")
    p.add_argument("--token", default=os.getenv("CLOUDFLARE_API_TOKEN"))
    p.add_argument("--prepare-only", action="store_true", help="Validate bytes; do not upload")
    p.add_argument("--poll-seconds", type=int, default=120)
    args = p.parse_args()
    data, sha, width, height = image_info(args.screenshot)
    key = f"perception/inputs/{sha}.png"
    manifest = {"sha256": sha, "width": width, "height": height,
                "bytes": len(data), "input_key": key, "exact_original": True}
    print(json.dumps({"prepared": manifest}, indent=2), flush=True)
    if args.prepare_only:
        return
    if not args.account or not args.token:
        p.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN")
    call(args.token, "PUT", object_route(args.account, args.bucket, key),
         data, content_type="application/octet-stream")
    print("Uploaded exact PNG to R2", flush=True)
    queue_id = queue_id_for_name(args.token, args.account, args.queue_name)
    enqueue_start(args.token, args.account, queue_id, key, sha)
    print("Server-side full-catalogue recognition queued", flush=True)
    until = time.monotonic() + max(args.poll_seconds, 0)
    while True:
        report = summarize(args.token, args.account, args.bucket, sha)
        if report and report.get("status") in ("ranked", "no_regions"):
            print(json.dumps(report, indent=2))
            return
        if time.monotonic() >= until:
            print(json.dumps(report or {"status": "waiting_for_localization"}, indent=2))
            sys.exit(2)
        time.sleep(3)


if __name__ == "__main__":
    main()
