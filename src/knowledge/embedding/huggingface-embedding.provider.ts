import { Injectable } from '@nestjs/common';
import { retryWithBackoff } from '../../common/retry';
import { ResolvedEmbeddingConfig } from '../../installations/installation-settings';
import { EmbeddingProvider } from './embedding-provider';

// HuggingFace's native feature-extraction pipeline (used by the HF Inference router for
// sentence-transformers models like BAAI/bge-small-en-v1.5). Base URL should point at the
// inference root, e.g. https://router.huggingface.co/hf-inference.
@Injectable()
export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'huggingface';

  async embed(texts: string[], config: ResolvedEmbeddingConfig): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const base = config.baseUrl.replace(/\/$/, '');
    const url = `${base}/models/${config.model}/pipeline/feature-extraction`;

    const result = await retryWithBackoff(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
        });
        if (!res.ok) {
          const detail = await res.text();
          const error = new Error(`Embedding request failed (${res.status}): ${detail}`);
          (error as { status?: number }).status = res.status;
          throw error;
        }
        return (await res.json()) as number[][] | number[];
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

    // A single-input request can come back as a flat vector; normalise to number[][].
    return Array.isArray(result[0]) ? (result as number[][]) : [result as number[]];
  }
}
