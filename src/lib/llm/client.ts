import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ============================================================
// LLM Client - Multi-provider abstraction
// Supports OpenAI, Anthropic, and Volcengine Ark (OpenAI-compatible)
// ============================================================

export type LLMProvider = 'openai' | 'anthropic' | 'volcengine';

// Volcengine Ark default model ID.
// Use a public Model ID like doubao-seed-2-1-pro-260628.
// Users can override this with their own Endpoint ID (ep-xxx) or another Model ID.
export const VOLCENGINE_DEFAULT_MODEL = 'doubao-seed-2-1-pro-260628';
export const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export function getModel(config: LLMConfig) {
  if (config.provider === 'volcengine') {
    const model = config.model || VOLCENGINE_DEFAULT_MODEL;
    // Use OpenAI-compatible provider to force /chat/completions endpoint.
    // The official @ai-sdk/openai provider defaults to OpenAI's /responses API,
    // which Volcengine Ark does not fully support.
    const volcengine = createOpenAICompatible({
      name: 'volcengine',
      apiKey: config.apiKey,
      baseURL: config.baseURL || VOLCENGINE_BASE_URL,
    });
    return volcengine(model);
  }

  if (config.provider === 'openai') {
    const model = config.model || 'gpt-4o-mini';
    const openai = createOpenAI({ apiKey: config.apiKey });
    return openai(model);
  }

  // Anthropic
  const model = config.model || 'claude-sonnet-4-20250514';
  const anthropic = createAnthropic({ apiKey: config.apiKey });
  return anthropic(model);
}

// Default models for different effort levels
export const MODEL_MAP: Record<LLMProvider, { high: string; medium: string; low: string }> = {
  openai: {
    high: 'gpt-4o',
    medium: 'gpt-4o-mini',
    low: 'gpt-4o-mini',
  },
  anthropic: {
    high: 'claude-sonnet-4-20250514',
    medium: 'claude-sonnet-4-20250514',
    low: 'claude-haiku-3-5-20241022',
  },
  volcengine: {
    high: VOLCENGINE_DEFAULT_MODEL,
    medium: VOLCENGINE_DEFAULT_MODEL,
    low: VOLCENGINE_DEFAULT_MODEL,
  },
};

export function getModelForEffort(
  provider: LLMProvider,
  apiKey: string,
  effort: 'high' | 'medium' | 'low'
) {
  const model = MODEL_MAP[provider][effort];
  return getModel({ provider, apiKey, model });
}
