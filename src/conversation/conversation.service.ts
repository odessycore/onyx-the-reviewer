import { Injectable } from '@nestjs/common';
import { ConversationMessage, ConversationThread } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationChannel } from './conversation.types';

const HISTORY_LIMIT = 12;

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  resolveThread(
    pullRequestId: string,
    channel: ConversationChannel,
    anchorId: string,
  ): Promise<ConversationThread> {
    return this.prisma.conversationThread.upsert({
      where: { pullRequestId_channel_anchorId: { pullRequestId, channel, anchorId } },
      create: { pullRequestId, channel, anchorId },
      update: {},
    });
  }

  appendMessage(
    threadId: string,
    role: 'user' | 'assistant',
    authorLogin: string,
    body: string,
    githubCommentId?: number,
  ): Promise<ConversationMessage> {
    return this.prisma.conversationMessage.create({
      data: {
        threadId,
        role,
        authorLogin,
        body,
        githubCommentId: githubCommentId === undefined ? null : BigInt(githubCommentId),
      },
    });
  }

  async getHistory(threadId: string): Promise<ConversationMessage[]> {
    const recent = await this.prisma.conversationMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    return recent.reverse();
  }
}
