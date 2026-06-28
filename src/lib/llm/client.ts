import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ============================================================
// LLM Client - Multi-provider abstraction
// Supports OpenAI, Anthropic, Volcengine Ark, and any custom
// OpenAI-compatible endpoint.
// ============================================================

export type LLMProvider = 'openai' | 'anthropic' | 'volcengine' | 'custom';

// Volcengine Ark default model ID.
export const VOLCENGINE_DEFAULT_MODEL = 'doubao-seed-2-1-pro-260628';
export const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

// Default endpoints for known providers (used by the browser client).
export const PROVIDER_DEFAULTS: Record<
  Exclude<LLMProvider, 'custom'>,
  { baseURL: string; model: string; label: string }
> = {
  volcengine: {
    baseURL: VOLCENGINE_BASE_URL,
    model: VOLCENGINE_DEFAULT_MODEL,
    label: '火山引擎',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    label: 'Anthropic',
  },
};

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export function getModel(config: LLMConfig) {
  if (config.provider === 'volcengine') {
    const model = config.model || VOLCENGINE_DEFAULT_MODEL;
    const volcengine = createOpenAICompatible({
      name: 'volcengine',
      apiKey: config.apiKey,
      baseURL: config.baseURL || VOLCENGINE_BASE_URL,
    });
    return volcengine(model);
  }

  if (config.provider === 'openai') {
    const model = config.model || 'gpt-4o-mini';
    const openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || undefined,
    });
    return openai(model);
  }

  if (config.provider === 'custom') {
    // Any OpenAI-compatible endpoint (e.g. DeepSeek, Moonshot, local Ollama, etc.)
    const model = config.model || 'gpt-3.5-turbo';
    const custom = createOpenAICompatible({
      name: 'custom',
      apiKey: config.apiKey || 'no-key',
      baseURL: config.baseURL || 'http://localhost:11434/v1',
    });
    return custom(model);
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
  custom: {
    high: '',
    medium: '',
    low: '',
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
