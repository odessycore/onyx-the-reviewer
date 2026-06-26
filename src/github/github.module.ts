import { Global, Module } from '@nestjs/common';
import { GithubApiService } from './github-api.service';
import { GithubClientFactory } from './github-client.factory';
import { WebhookController } from './webhook.controller';
import { WebhookRouterService } from './webhook-router.service';
import { WebhookVerificationService } from './webhook-verification.service';

@Global()
@Module({
  controllers: [WebhookController],
  providers: [
    GithubClientFactory,
    GithubApiService,
    WebhookVerificationService,
    WebhookRouterService,
  ],
  exports: [GithubApiService],
})
export class GithubModule {}
