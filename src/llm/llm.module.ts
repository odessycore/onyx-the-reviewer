import { Global, Module } from '@nestjs/common';
import { LlmProviderRegistry } from './llm-provider.registry';
import { LlmService } from './llm.service';
import { LLM_PROVIDERS } from './llm.types';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiCompatibleLlmProvider } from './providers/openai-compatible.provider';

@Global()
@Module({
  providers: [
    AnthropicProvider,
    OpenAiCompatibleLlmProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (anthropic: AnthropicProvider, openAiCompatible: OpenAiCompatibleLlmProvider) => [
        anthropic,
        openAiCompatible,
      ],
      inject: [AnthropicProvider, OpenAiCompatibleLlmProvider],
    },
    LlmProviderRegistry,
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
