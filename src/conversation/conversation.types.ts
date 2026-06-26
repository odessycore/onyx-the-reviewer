export type CommandName = 'review' | 'explain' | 'summarize' | 'ask';

export type ConversationChannel = 'issue' | 'review';

export interface ParsedCommand {
  command: CommandName;
  focus?: string;
  target?: string;
  question?: string;
}

export interface PrCommandPayload {
  repositoryId: string;
  installationGithubId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  channel: ConversationChannel;
  anchorId: string;
  replyToCommentId: number;
  authorLogin: string;
  command: CommandName;
  focus?: string;
  target?: string;
  question?: string;
}
