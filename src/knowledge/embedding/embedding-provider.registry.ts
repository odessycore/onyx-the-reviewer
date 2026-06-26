import { Inject, Injectable } from '@nestjs/common';
import { EMBEDDING_PROVIDERS, EmbeddingProvider } from './embedding-provider';

@Injectable()
export class EmbeddingProviderRegistry {
  private readonly providers: Map<string, EmbeddingProvider>;

  constructor(@Inject(EMBEDDING_PROVIDERS) providers: EmbeddingProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  get(name: string): EmbeddingProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown embedding provider "${name}". Available: ${[...this.providers.keys()].join(', ')}`,
      );
    }
    return provider;
  }
}
