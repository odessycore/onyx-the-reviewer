import { Injectable } from '@nestjs/common';
import { retryWithBackoff } from '../../common/retry';
import {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmCredentials,
  LlmProvider,
} from '../llm.types';

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// Targets the OpenAI `/chat/completions` schema, which is also served by the HuggingFace
// router, vLLM, Ollama, LM Studio and most self-hosted gateways — so any of those models
// (including open-source ones) can drive reviews via a base URL + key.
@Injectable()
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name = 'openai-compatible';

  async complete(
    request: LlmCompletionRequest,
    credentials: LlmCredentials,
  ): Promise<LlmCompletionResult> {
    if (!credentials.baseUrl) {
      throw new Error('openai-compatible provider requires LLM_BASE_URL');
    }
    const url = `${credentials.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      { role: 'user', content: request.prompt },
    ];

    const response = await retryWithBackoff(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: credentials.model,
            messages,
            max_tokens: request.maxTokens ?? 4096,
            temperature: request.temperature ?? 0.2,
          }),
        });
        if (!res.ok) {
          const detail = await res.text();
          const error = new Error(`Chat completion failed (${res.status}): ${detail}`);
          (error as { status?: number }).status = res.status;
          throw error;
        }
        return (await res.json()) as ChatCompletionResponse;
      },
      {
        maxAttempts: 4,
        baseMs: 1000,
        capMs: 20000,
        shouldRetry: (error) => {
          const status = (error as { status?: number }).status ?? 0;
          return status === 0 || status === 429 || status >= 500;
        },
      },
    );

    return {
      text: response.choices[0]?.message.content ?? '',
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
