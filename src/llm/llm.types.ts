export interface LlmCredentials {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LlmCompletionRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletionResult {
  text: string;
  usage: LlmUsage;
}

// A pluggable LLM backend. Implementations are stateless; per-installation credentials
// are supplied per call so a single instance serves every installation.
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmCompletionRequest, credentials: LlmCredentials): Promise<LlmCompletionResult>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
