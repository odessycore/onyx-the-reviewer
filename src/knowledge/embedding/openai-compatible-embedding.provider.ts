import { Injectable } from '@nestjs/common';
import { retryWithBackoff } from '../../common/retry';
import { ResolvedEmbeddingConfig } from '../../installations/installation-settings';
import { EmbeddingProvider } from './embedding-provider';

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

// Targets the OpenAI `/embeddings` schema, which is also exposed by HuggingFace TGI,
// vLLM, LM Studio, Ollama and most self-hosted embedding servers.
@Injectable()
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';

  async embed(texts: string[], config: ResolvedEmbeddingConfig): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const url = `${config.baseUrl.replace(/\/$/, '')}/embeddings`;

    const response = await retryWithBackoff(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: config.model, input: texts }),
        });
        if (!res.ok) {
          const detail = await res.text();
          const error = new Error(`Embedding request failed (${res.status}): ${detail}`);
          (error as { status?: number }).status = res.status;
          throw error;
        }
        return (await res.json()) as EmbeddingResponse;
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

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding);
  }
}
