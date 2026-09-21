import test from 'node:test';
import assert from 'node:assert/strict';
import serverlessExpress from '@codegenie/serverless-express';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createApp } from '../src/app.js';
import { createSduiRouter } from '../cornerstone-package/src/sdui-routes.js';

test('Lambda parses SDUI JSON before asynchronous rate limiting', async t => {
  const previousTable = process.env.RATE_LIMIT_TABLE;
  process.env.RATE_LIMIT_TABLE = 'test';
  t.after(() => {
    if (previousTable === undefined) delete process.env.RATE_LIMIT_TABLE;
    else process.env.RATE_LIMIT_TABLE = previousTable;
  });
  let checks = 0;
  t.mock.method(DynamoDBClient.prototype, 'send', async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    checks++;
    return { Attributes: { request_count: { N: '1' } } };
  });
  const body = { name: 'Test', schema: { type: 'template_widget', templateType: 'SDUI_WIDGET', data: [] } };
  let saved;
  const router = createSduiRouter({ create: async value => {
    saved = value;
    return { id: 'c6ccf393-5f60-49e3-94c5-0655b59764c0', ...value };
  } });
  const handler = serverlessExpress({ app: createApp([
    { name: 'test', basePath: '/api/cornerstone-package/sdui', router }
  ]) });
  const response = await handler({
    version: '2.0', routeKey: '$default',
    rawPath: '/api/cornerstone-package/sdui/templates', rawQueryString: '',
    headers: { 'content-type': 'application/json', host: 'localhost' },
    requestContext: { http: { method: 'POST', path: '/api/cornerstone-package/sdui/templates', sourceIp: '127.0.0.1', protocol: 'HTTP/1.1' } },
    body: JSON.stringify(body), isBase64Encoded: false
  }, {});
  assert.equal(response.statusCode, 201);
  assert.deepEqual(saved, body);
  assert.equal(checks, 2);
});
