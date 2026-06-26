import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class WebhookVerificationService {
  constructor(private readonly config: AppConfigService) {}

  // Verifies the GitHub `X-Hub-Signature-256` HMAC over the raw request body using a
  // constant-time comparison.
  verify(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) {
      return false;
    }
    const expected =
      'sha256=' +
      createHmac('sha256', this.config.github.webhookSecret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(signatureHeader);
    return (
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer)
    );
  }
}
