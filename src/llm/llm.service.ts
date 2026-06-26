import { Injectable } from '@nestjs/common';
import { extractJson } from './json';
import { LlmProviderRegistry } from './llm-provider.registry';
import { LlmCompletionRequest, LlmCompletionResult, LlmCredentials } from './llm.types';

export interface StructuredResult<T> {
  data: T;
  usage: LlmCompletionResult['usage'];
}

// Provider-agnostic entry point. Resolves the configured provider and adds a structured
// (JSON) completion helper on top of the raw text interface every provider implements.
@Injectable()
export class LlmService {
  constructor(private readonly registry: LlmProviderRegistry) {}

  complete(
    provider: string,
    credentials: LlmCredentials,
    request: LlmCompletionRequest,
  ): Promise<LlmCompletionResult> {
    return this.registry.get(provider).complete(request, credentials);
  }

  async completeJson<T>(
    provider: string,
    credentials: LlmCredentials,
    request: LlmCompletionRequest,
  ): Promise<StructuredResult<T>> {
    const result = await this.complete(provider, credentials, {
      ...request,
      system: `${request.system ?? ''}\n\nRespond with a single valid JSON value and nothing else.`.trim(),
    });
    return { data: extractJson<T>(result.text), usage: result.usage };
  }
}
