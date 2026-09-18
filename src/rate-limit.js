import { createHash } from 'node:crypto';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { LambdaClient, PutFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (raw || req.socket.remoteAddress || 'unknown').trim();
}

export function createRateLimitMiddleware(options = {}) {
  const tableName = options.tableName ?? process.env.RATE_LIMIT_TABLE;
  if (!tableName) return (_req, _res, next) => next();

  const dailyLimit = positiveInteger(options.dailyLimit ?? process.env.MAX_REQUESTS_PER_DAY, 10000);
  const minuteLimit = positiveInteger(options.minuteLimit ?? process.env.MAX_REQUESTS_PER_MINUTE_PER_IP, 60);
  const dynamo = options.dynamo ?? new DynamoDBClient({});
  const lambda = options.lambda ?? new LambdaClient({});
  const functionName = options.functionName ?? process.env.AWS_LAMBDA_FUNCTION_NAME;
  const now = options.now ?? (() => new Date());

  async function increment(key, expiresAt) {
    const response = await dynamo.send(new UpdateItemCommand({
      TableName: tableName,
      Key: { bucket: { S: key } },
      UpdateExpression: 'SET expires_at = :expires ADD request_count :one',
      ExpressionAttributeValues: {
        ':expires': { N: String(expiresAt) },
        ':one': { N: '1' }
      },
      ReturnValues: 'UPDATED_NEW'
    }));
    return Number(response.Attributes?.request_count?.N || 0);
  }

  return async (req, res, next) => {
    try {
      const timestamp = now();
      const day = timestamp.toISOString().slice(0, 10);
      const minute = timestamp.toISOString().slice(0, 16);
      const tomorrow = Date.UTC(
        timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate() + 2
      ) / 1000;
      const dailyCount = await increment(`global#${day}`, tomorrow);

      res.set('X-RateLimit-Daily-Limit', String(dailyLimit));
      res.set('X-RateLimit-Daily-Remaining', String(Math.max(0, dailyLimit - dailyCount)));

      if (dailyCount >= dailyLimit && functionName) {
        await lambda.send(new PutFunctionConcurrencyCommand({
          FunctionName: functionName,
          ReservedConcurrentExecutions: 0
        }));
      }
      if (dailyCount > dailyLimit) {
        return res.status(429).json({ error: 'Daily request limit exceeded' });
      }

      const ipHash = createHash('sha256').update(requestIp(req)).digest('hex').slice(0, 24);
      const minuteCount = await increment(`ip#${ipHash}#${minute}`, Math.floor(timestamp.getTime() / 1000) + 3600);
      res.set('X-RateLimit-Limit', String(minuteLimit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, minuteLimit - minuteCount)));
      if (minuteCount > minuteLimit) {
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'Too many requests' });
      }
      next();
    } catch (error) {
      console.error('Rate limit check failed:', error.name || 'unknown_error');
      res.status(503).json({ error: 'Request limit service unavailable' });
    }
  };
}
