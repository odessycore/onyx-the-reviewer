import { Inject, Injectable } from '@nestjs/common';
import { LLM_PROVIDERS, LlmProvider } from './llm.types';

@Injectable()
export class LlmProviderRegistry {
  private readonly providers: Map<string, LlmProvider>;

  constructor(@Inject(LLM_PROVIDERS) providers: LlmProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  get(name: string): LlmProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown LLM provider "${name}". Available: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    return provider;
  }
}
