# Cloudflare backup

Point-in-time snapshot of the Bazaar Cloudflare estate.

- Worker source is stored as the exact Cloudflare content-v2 multipart payload, except obvious credential literals are redacted.
- Worker settings, deployments, schedules, secret binding names, and workers.dev state are recorded.
- Queue configuration and consumer topology are recorded.
- R2 binary objects are not duplicated into Git. Exact object inventories (key, size, etag, timestamps) are recorded.
- Secret values and binding values are intentionally excluded/redacted.
