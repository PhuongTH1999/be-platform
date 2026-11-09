# Layout Snapshot API

Stores a CNS layout response (`{first_loads, lazy_loads, ...}`) for 24 hours so another client can fetch it by id.
Used by the tool's Dev Tools → Inspector ("Tạo QR"); the QR deep link carries only `{"snapshotId": "<id>"}`.
The API has no authentication: anyone who knows an id can read it, so never store anything you would not share.

Base: `/api/cornerstone-package/layout-snapshots` (the `/api/layout-snapshots` alias also works).

## POST `/layout-snapshots`

```json
{
  "layout": { "first_loads": [], "lazy_loads": [] },
  "meta": { "refId": "…", "blockId": "…", "platform": "android", "env": "dev", "appVersion": "1.2.3" }
}
```

- `layout` (required): object with a `lazy_loads` array. Any other keys are stored as sent. Nesting is limited to 64 levels.
- `meta` (optional): only `refId`, `blockId`, `platform`, `env`, `appVersion` are kept; each must be a string of at most 100 characters.
- Keys named `session`, `userID`, `user_id`, `agent_id`, `phone` (case-insensitive) are removed at any depth in `layout`.
  Clients should still strip them first.
- Request body limit: 256 KB (serialized JSON).

Response `201`: `{ "success": true, "id": "<uuid v4>", "expiresAt": "<ISO time, now + 24h>" }`, with a `Location` header.

| Status | When |
| :- | :- |
| 400 | Wrong shape, bad `meta`, nesting too deep |
| 413 | Body over 256 KB (bodies over 1 MB are rejected earlier by the shared JSON parser, also 413) |
| 429 | Shared rate limiter, when enabled |
| 503 | Migration 003 not applied |

## GET `/layout-snapshots/:id/json`

`200` returns the bare layout (`{ first_loads, lazy_loads, ... }`), ready to hand to native-widget's `onRequestCornerStone` unchanged.

## GET `/layout-snapshots/:id`

`200 { "success": true, "snapshot": { "id", "meta", "createdAt", "expiresAt", "sizeBytes" } }` (no layout).

Both GET routes: `400` invalid UUID, `404` unknown id (or purged), `410` expired. Responses are `Cache-Control: no-store`.

## Storage and cleanup

- Table `cornerstone_layout_snapshots`, created by `migrations/003_create_layout_snapshots.sql`.
  The server never runs migrations: apply the SQL in Supabase before deploying this code.
- Expiry is enforced on read (`expires_at`). Every successful create also deletes rows that expired more than 1 day ago,
  so an expired id returns 410 for a day, then 404. An optional hourly `pg_cron` purge is in the migration comments.
- Code: `src/snapshot-routes.js`, `src/snapshot-store.js` (Supabase store plus an in-memory store for tests). Tests: `test/snapshot.test.js`.
