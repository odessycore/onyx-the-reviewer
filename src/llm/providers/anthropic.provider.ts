import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { retryWithBackoff } from '../../common/retry';
import {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmCredentials,
  LlmProvider,
} from '../llm.types';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';

  async complete(
    request: LlmCompletionRequest,
    credentials: LlmCredentials,
  ): Promise<LlmCompletionResult> {
    const client = new Anthropic({ apiKey: credentials.apiKey });

    const response = await retryWithBackoff(
      () =>
        client.messages.create({
          model: credentials.model,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.2,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
        }),
      {
        maxAttempts: 4,
        baseMs: 1000,
        capMs: 20000,
        shouldRetry: (error) => RETRYABLE_STATUSES.has((error as { status?: number }).status ?? 0),
      },
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
