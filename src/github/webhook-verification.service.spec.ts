import { createHmac } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { WebhookVerificationService } from './webhook-verification.service';

const sign = (secret: string, body: Buffer): string =>
  'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('WebhookVerificationService', () => {
  const secret = 'top-secret';
  const config = { github: { webhookSecret: secret } } as AppConfigService;
  const service = new WebhookVerificationService(config);
  const body = Buffer.from(JSON.stringify({ action: 'opened' }));

  it('accepts a valid signature', () => {
    expect(service.verify(body, sign(secret, body))).toBe(true);
  });

  it('rejects a signature from the wrong secret', () => {
    expect(service.verify(body, sign('wrong', body))).toBe(false);
  });

  it('rejects a tampered body', () => {
    const signature = sign(secret, body);
    expect(service.verify(Buffer.from('{"action":"closed"}'), signature)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(service.verify(body, undefined)).toBe(false);
  });
});
