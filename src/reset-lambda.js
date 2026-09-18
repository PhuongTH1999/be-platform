import { LambdaClient, DeleteFunctionConcurrencyCommand } from '@aws-sdk/client-lambda';

const client = new LambdaClient({});

export async function handler() {
  const functionName = process.env.TARGET_FUNCTION_NAME;
  if (!functionName) throw new Error('TARGET_FUNCTION_NAME is required');
  try {
    await client.send(new DeleteFunctionConcurrencyCommand({ FunctionName: functionName }));
  } catch (error) {
    // No reserved concurrency means the API is already open.
    if (error.name !== 'ResourceNotFoundException') throw error;
  }
  return { reset: true, functionName };
}
