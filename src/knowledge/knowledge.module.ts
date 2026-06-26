import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding/embedding.service';
import { EMBEDDING_PROVIDERS } from './embedding/embedding-provider';
import { EmbeddingProviderRegistry } from './embedding/embedding-provider.registry';
import { HuggingFaceEmbeddingProvider } from './embedding/huggingface-embedding.provider';
import { OpenAiCompatibleEmbeddingProvider } from './embedding/openai-compatible-embedding.provider';
import { BootstrapRepositoryHandler } from './handlers/bootstrap-repository.handler';
import { RefreshIndexHandler } from './handlers/refresh-index.handler';
import { KnowledgeRetrieverService } from './knowledge-retriever.service';
import { RepoIndexerService } from './repo-indexer.service';
import { RepoProfileService } from './repo-profile.service';

@Module({
  providers: [
    OpenAiCompatibleEmbeddingProvider,
    HuggingFaceEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDERS,
      useFactory: (
        openAiCompatible: OpenAiCompatibleEmbeddingProvider,
        huggingface: HuggingFaceEmbeddingProvider,
      ) => [openAiCompatible, huggingface],
      inject: [OpenAiCompatibleEmbeddingProvider, HuggingFaceEmbeddingProvider],
    },
    EmbeddingProviderRegistry,
    EmbeddingService,
    RepoProfileService,
    RepoIndexerService,
    KnowledgeRetrieverService,
    BootstrapRepositoryHandler,
    RefreshIndexHandler,
  ],
  exports: [KnowledgeRetrieverService],
})
export class KnowledgeModule {}
