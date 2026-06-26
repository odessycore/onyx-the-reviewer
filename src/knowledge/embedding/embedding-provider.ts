import { ResolvedEmbeddingConfig } from '../../installations/installation-settings';

// Embeddings are intentionally decoupled from the chat LLM: the chat provider (e.g.
// Anthropic) often has no embeddings API, so any OpenAI-compatible / HF endpoint can serve here.
export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[], config: ResolvedEmbeddingConfig): Promise<number[][]>;
}

export const EMBEDDING_PROVIDERS = Symbol('EMBEDDING_PROVIDERS');
