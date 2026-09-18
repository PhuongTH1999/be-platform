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

Production example:

```bash
curl -fsS --max-time 60 \
  'https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/cornerstone-package/packages/momo-platform/cornerstone-native/versions'
```

Existing `/api/packages/...` URLs remain supported. Storage is Supabase (`public.packages`, `public.versions`), not SQLite. `supabase-schema.sql` contains the project schema; apply it only when setting up an empty database.

The SQLite import script is a manual legacy migration tool with its own `better-sqlite3` dependency in this folder. It is not run by the server or included in the production image. Do not run it against existing data unless you intend to import/upsert that data.

See the root README for shared architecture, environment settings and AWS Lambda deployment.

## SDUI templates

CRUD và lấy JSON render: [SDUI_API.md](SDUI_API.md). Base path: `/api/cornerstone-package/sdui/templates`.
