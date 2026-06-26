import { Injectable } from '@nestjs/common';
import { ResolvedEmbeddingConfig } from '../../installations/installation-settings';
import { EmbeddingProviderRegistry } from './embedding-provider.registry';

const BATCH_SIZE = 64;

@Injectable()
export class EmbeddingService {
  constructor(private readonly registry: EmbeddingProviderRegistry) {}

  async embedBatch(texts: string[], config: ResolvedEmbeddingConfig): Promise<number[][]> {
    const provider = this.registry.get(config.provider);
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      vectors.push(...(await provider.embed(batch, config)));
    }
    return vectors;
  }

  async embedOne(text: string, config: ResolvedEmbeddingConfig): Promise<number[]> {
    const [vector] = await this.registry.get(config.provider).embed([text], config);
    return vector;
  }
}
