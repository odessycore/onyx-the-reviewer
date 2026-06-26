export interface ResolvedLlmConfig {
  provider: string;
  baseUrl?: string;
  model: string;
  apiKey?: string;
}

export interface ResolvedEmbeddingConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  dimensions: number;
}
