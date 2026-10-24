# Bazaar

Canonical GitHub backup for the Bazaar screenshot-understanding project.

## Goal

Convert arbitrary *The Bazaar* in-game screenshots into trustworthy structured game state:

```
pixels -> localized/recognized game objects -> canonical identities -> structured game data + visible instance state
```

## Cloudflare backup

The `cloudflare/` directory contains a point-in-time backup of the Bazaar Cloudflare estate captured on 2026-10-23.

It includes:

- source/content snapshots for 64 Bazaar Workers, including the production and current proof Workers
- Worker settings, deployments, schedules, workers.dev state, and secret binding names
- configuration and consumer topology for 59 Bazaar Queues
- exact R2 object inventories for both Bazaar buckets
- current project-status and handoff artifacts

The Cloudflare snapshot was created in commit `f89ae079b3a1e003a37c94cf1a063ed3fd1b44c6`.

## R2 data policy

At snapshot time the two Bazaar R2 buckets contained 18,574 objects totaling about 2.33 GB. Those binary object bytes are not duplicated into normal Git history. Instead, `cloudflare/r2/` contains exact inventories including object key, size, etag, timestamps, and bucket metadata.

## Secrets

Secret values and binding values are intentionally excluded or redacted. One old experimental Worker contained a hard-coded token literal; the GitHub backup records that redaction rather than publishing the credential.

## Current project state

See `cloudflare/project-status/latest.json`.
