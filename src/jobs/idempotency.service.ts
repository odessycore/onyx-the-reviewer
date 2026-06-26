import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  // Records a webhook delivery, returning false if this delivery id was already seen.
  // GitHub retries deliveries, so this is the first line of idempotency.
  async registerDelivery(deliveryId: string, event: string, action?: string): Promise<boolean> {
    try {
      await this.prisma.webhookDelivery.create({ data: { deliveryId, event, action } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return false;
      }
      throw error;
    }
  }

  reviewKey(repositoryId: string, prNumber: number, headSha: string): string {
    return `review:${repositoryId}:${prNumber}:${headSha}`;
  }

  bootstrapKey(repositoryId: string): string {
    return `bootstrap:${repositoryId}`;
  }

  refreshKey(repositoryId: string, sha: string): string {
    return `refresh:${repositoryId}:${sha}`;
  }

  commandKey(commentId: number): string {
    return `command:${commentId}`;
  }
}
