import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { IdempotencyService } from '../jobs/idempotency.service';
import { WebhookRouterService } from './webhook-router.service';
import { WebhookVerificationService } from './webhook-verification.service';

@Controller('webhooks/github')
export class WebhookController {
  constructor(
    private readonly verification: WebhookVerificationService,
    private readonly idempotency: IdempotencyService,
    private readonly router: WebhookRouterService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-github-event') event: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<{ status: string }> {
    const rawBody = request.rawBody;
    if (!rawBody || !this.verification.verify(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = request.body as { action?: string };
    const isNew = await this.idempotency.registerDelivery(deliveryId, event, payload.action);
    if (!isNew) {
      return { status: 'duplicate' };
    }

    await this.router.route(event, payload);
    return { status: 'accepted' };
  }
}
