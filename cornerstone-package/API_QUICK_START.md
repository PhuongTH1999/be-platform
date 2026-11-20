# Cornerstone Package API

This is the first project module in the shared `be-platform` backend.

Start at the repository root with `npm ci` and `npm start`. Use the root `.env` for Supabase credentials. The old `src/index.js` entry point delegates to the shared server.

Production base URL:
`https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package`

Local development base URL: `http://localhost:3000/api/cornerstone-package`.
Use the same endpoint paths in both environments.

- `GET /packages`
- `POST /packages/sync`
- `GET /packages/momo-platform/cornerstone-native`
- `GET /packages/momo-platform/cornerstone-native/versions`
- `PATCH /packages/momo-platform/cornerstone-native/versions/:version` (release notes, below)

Production example:

```bash
curl -fsS --max-time 60 \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/packages/momo-platform/cornerstone-native/versions'
```

Existing `/api/packages/...` URLs remain supported. Storage is Supabase (`public.packages`, `public.versions`), not SQLite. `supabase-schema.sql` contains the project schema; apply it only when setting up an empty database.

The SQLite import script is a manual legacy migration tool with its own `better-sqlite3` dependency in this folder. It is not run by the server or included in the production image. Do not run it against existing data unless you intend to import/upsert that data.

See the root README for shared architecture, environment settings and AWS Lambda deployment.

## Release notes

Each version carries release notes edited from the Cornerstone tool's ChangeLog tab. Apply
`migrations/004_add_version_release_notes.sql` before deploying the code that serves them.

### Version item

`GET /packages/:scope/:name/versions` returns these fields for every item. The release-note fields are `null`
until someone edits them:

```json
{
  "version": "1.1.0-caching.ios.1",
  "release_date": "2026-11-01T00:00:00+00:00",
  "changelog": "raw text from POST /packages/sync",
  "created_at": "2026-11-01T00:00:05+00:00",
  "release_type": "feature",
  "summary": "## What changed\n...",
  "service_action": "Bump `@momo-platform/native-widget` to 1.1.0 ...",
  "notes_updated_at": "2026-11-20T03:00:00.000Z",
  "notes_updated_by": "phuong"
}
```

- `release_type`: `feature`, `hotfix` or `null`.
- `summary`: markdown describing what the version did.
- `service_action`: markdown describing what consuming services must do to upgrade.

If migration 004 has not been applied, GET still works and returns the five release-note fields as `null`.

### Edit notes

`PATCH /packages/:scope/:name/versions/:version`. URL-encode the version. It must match
`[0-9A-Za-z.+_-]{1,100}` exactly.

```bash
curl -fsS -X PATCH -H 'Content-Type: application/json' \
  'http://localhost:3000/api/cornerstone-package/packages/momo-platform/native-widget/versions/1.1.0-caching.ios.1' \
  -d '{"release_type":"hotfix","summary":"Fix cache crash on iOS 15","service_action":"Upgrade before 2026-12-01","updated_by":"phuong"}'
```

Body: a JSON object with any of `release_type`, `summary`, `service_action` and `updated_by`. At least one of
the first three must be present.

- An absent key leaves the field unchanged. `null` clears it.
- `release_type` must be `feature`, `hotfix`, `null` or `""` (which clears it).
- `summary` and `service_action` are strings or `null`. Content is stored verbatim with no trimming, so code
  fences and tables survive. An empty or whitespace-only string clears the field. Each is limited to 256 KB of
  UTF-8. Content is untrusted user input: the API never renders it, so clients must sanitise on display.
- `updated_by` is optional free text. It is trimmed and cut to 200 characters.
- Every successful PATCH sets `notes_updated_at` to the server time and `notes_updated_by` to `updated_by`
  (or `null`). The last write wins.

| Status | Body |
| --- | --- |
| 200 | `{ "success": true, "package_name": "@scope/name", "version": { ...version item } }` |
| 400 | `{ "success": false, "error": "..." }`: unknown key, wrong type, invalid `release_type` or version, no note field |
| 413 | `{ "success": false, "error": "summary is larger than 256 KB" }` (whole body over 1 MB: `{ "error": "Request body too large" }`) |
| 404 | `{ "success": false, "error": "Package not found" }` or `"Version not found"`. PATCH never creates versions. |
| 503 | `{ "success": false, "error": "Release notes storage is not initialized" }`: migration 004 not applied |
| 500 | `{ "success": false, "error": "Unable to update release notes" }` |

PATCH has no authentication: anyone who can reach the API can edit notes. Browsers send a CORS preflight for
it, so the Lambda Function URL CORS configuration must allow `PATCH` and the `content-type` header.

### Sync

`POST /packages/sync` accepts an optional `releaseType` (`feature` or `hotfix`; any other value gets 400). It
sets `release_type` only while that is `null`, so an edited value always wins. Re-syncing a version still
replaces `release_date` and `changelog`, but never writes `summary`, `service_action` or `notes_*`. Payloads
without `releaseType` behave exactly as before, including before migration 004 is applied. Sending
`releaseType` before migration 004 is applied gets 503.

## SDUI templates

CRUD và lấy JSON render: [SDUI_API.md](SDUI_API.md). Base path: `/api/cornerstone-package/sdui/templates`.
