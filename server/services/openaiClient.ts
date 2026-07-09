import OpenAI from 'openai';

let _client: OpenAI | null = null;

export interface OpenAIClientOptions {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
}

export function getOpenAIClient(options?: OpenAIClientOptions): OpenAI {
  const { apiKey, baseURL, timeout } = options || {};

  if (apiKey) {
    return new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(timeout ? { timeout } : {}),
    });
  }

  if (!_client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('[openaiClient] OPENAI_API_KEY não configurada');
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}
