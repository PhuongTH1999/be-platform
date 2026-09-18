# be-platform

**Hướng dẫn thêm API/project, Supabase, test và deploy:** [docs/ADDING_API.md](docs/ADDING_API.md).

Shared Node.js / Express backend. Supabase connection and HTTP server are managed at the repository root. Each project owns its routes, database checks and SQL in its own folder.

```text
src/
  index.js       # environment, startup, shutdown
  app.js         # shared middleware and route mounting
  db.js          # shared Supabase client
  projects.js    # project registry
cornerstone-package/
  src/project.js # project registration and startup check
  src/routes.js  # package business logic
  supabase-schema.sql
Dockerfile
scripts/package-lambda.sh
```

## Local startup

Use Node.js 22 or later, then run from the repository root:

```sh
npm ci
npm start
npm test
```

Root `.env` settings (never commit credentials):

```dotenv
PORT=3000
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
```

Existing `SUPABASE_SERVICE_ROLE_KEY` is also accepted for compatibility. The root `.env` is used even when invoking the old Cornerstone entry point. Supabase tables must already exist; the server does not run SQL or migrate data on startup.

## API

- `GET /api/health`: shared process health.
- `GET /`: project registry.
- `/api/cornerstone-package/packages`: Cornerstone package endpoints.
- `/api/packages`: compatibility alias for existing clients.

Both prefixes support `GET /packages`, `POST /packages/sync`, `GET /packages/:scope/:name` and `GET /packages/:scope/:name/versions` relative to their `/api` or `/api/cornerstone-package` mount. Example: `/api/cornerstone-package/packages/momo-platform/cornerstone-native/versions`.

The existing write API has no authentication. Anyone who can reach it can sync package data. Route namespaces organize projects; they are not access-control boundaries. Supabase server credentials must never be sent to clients.

## Add a project

1. Create `<project-name>/src/routes.js` exporting an Express router.
2. Create `<project-name>/src/project.js` exporting `{ name, basePath, router, checkDatabase? }`.
3. Register it in `src/projects.js`.
4. Keep its SQL and business logic in its project folder. Import `getDB` from the shared `src/db.js`. Use distinct table names or a separately configured schema to avoid collisions.
5. Add its source directory to `scripts/package-lambda.sh` so it is included in the Lambda ZIP.

All modules currently use one Supabase project and the existing public schema. Cornerstone keeps its existing `packages` and `versions` tables; no tables or data were renamed.

## Cornerstone SDUI templates

See [SDUI API guide](cornerstone-package/SDUI_API.md) for CRUD endpoints, the Supabase migration and a sample template.

## AWS Lambda

The production API can run on AWS Lambda in `us-east-1` using
`src/lambda.handler`. Build the deployment ZIP with `npm run package:lambda`.
The Lambda uses a public Function URL and the same Supabase database. Keep
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Lambda environment variables;
never include `.env` in the deployment ZIP.

Production CORS is configured on the Lambda Function URL. Express only adds
CORS headers during local development, preventing duplicate
`Access-Control-Allow-Origin` headers in browser responses.

Production URL:
`https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/`

All current and future `be-platform` routes use this same Function URL. Keep
the route path unchanged when moving a client from local development to AWS:

```text
Local:      http://localhost:3000/api/...
Production: https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/...
```

AWS request protection uses DynamoDB table `be-platform-rate-limit`:
10,000 requests per UTC day globally and 60 requests per IP per minute. At
the daily maximum, the API Lambda sets its reserved concurrency to zero. The
`be-platform-daily-reset` Lambda is invoked by EventBridge at 00:00 UTC to
remove that lock. Request bodies are limited to 1 MB.

Deploy a code update from the repository root:

```sh
npm test
npm run package:lambda
aws lambda update-function-code \
  --function-name be-platform \
  --region us-east-1 \
  --zip-file fileb://dist/be-platform-lambda.zip
aws lambda wait function-updated \
  --function-name be-platform \
  --region us-east-1
curl -fsS --max-time 60 \
  https://yepswakp3nxo4qoeynn74xhnt40wqlia.lambda-url.us-east-1.on.aws/api/health
```

Source changes require a new Lambda deployment. Supabase data changes do not.
Changing local `.env` does not update Lambda environment variables.

### Check today's request usage

The daily maximum is stored in Lambda environment variable
`MAX_REQUESTS_PER_DAY`. The current UTC-day usage is stored in DynamoDB table
`be-platform-rate-limit` with bucket `global#YYYY-MM-DD`. The counter resets at
00:00 UTC (07:00 in Vietnam).

```sh
TODAY_UTC="$(date -u +%Y-%m-%d)"

aws lambda get-function-configuration \
  --function-name be-platform \
  --region us-east-1 \
  --query 'Environment.Variables.MAX_REQUESTS_PER_DAY' \
  --output text

aws dynamodb get-item \
  --table-name be-platform-rate-limit \
  --region us-east-1 \
  --key "{\"bucket\":{\"S\":\"global#$TODAY_UTC\"}}" \
  --consistent-read \
  --query 'Item.request_count.N' \
  --output text
```

In the AWS Console, open DynamoDB → Tables → `be-platform-rate-limit` →
Explore table items to see `request_count`. Remaining requests are
`MAX_REQUESTS_PER_DAY - request_count`. Lambda → `be-platform` → Monitor shows
invocations, errors, throttles and duration; it does not calculate the custom
daily remainder.
