# Bazaar

Canonical GitHub backup for the Bazaar screenshot-understanding project.

## Goal

Convert arbitrary *The Bazaar* in-game screenshots into trustworthy structured game state:

```
pixels -> localized/recognized game objects -> canonical identities -> structured game data + visible instance state
```

## Cloudflare backup

The `cloudflare/` directory is a point-in-time backup of the live Bazaar resources in Cloudflare. It includes Worker source/configuration, queue topology, R2 inventories, and project handoff/state artifacts. Secret values are intentionally excluded.

Large binary R2 corpus objects are catalogued by exact key/size/etag rather than duplicated into GitHub through the connector.
