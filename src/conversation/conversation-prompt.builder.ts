import { Injectable } from '@nestjs/common';
import { ConversationMessage } from '@prisma/client';
import { PullRequestInfo } from '../github/github.types';
import { ChangedFileRef, KnowledgeContext } from '../knowledge/knowledge.types';
import { CommandName } from './conversation.types';

const MAX_DIFF_CHARS = 30_000;
const MAX_CHUNK_CHARS = 1_200;
const MAX_FILE_CHARS = 12_000;
const MAX_MESSAGE_CHARS = 2_000;

export interface ConversationPromptInput {
  command: CommandName;
  focus?: string;
  target?: string;
  question?: string;
  pr: PullRequestInfo;
  changedFiles: ChangedFileRef[];
  knowledge: KnowledgeContext;
  history: ConversationMessage[];
  targetFileContent?: string | null;
  botLogin: string;
}

@Injectable()
export class ConversationPromptBuilder {
  build(input: ConversationPromptInput): { system: string; prompt: string } {
    const system =
      `You are ${input.botLogin}, a senior engineer answering questions about a specific ` +
      `GitHub pull request. Be concise and accurate, reference file paths and line numbers, ` +
      `and ground answers in the diff and repository context provided. If something isn't in ` +
      `the context, say so rather than guessing. Reply in GitHub-flavored markdown.`;

    const sections = [
      this.taskSection(input),
      this.prSection(input.pr),
      this.targetFileSection(input),
      this.diffSection(input.changedFiles),
      this.contextSection(input.knowledge),
      this.historySection(input.history),
    ];
    return { system, prompt: sections.filter(Boolean).join('\n\n') };
  }

  private taskSection(input: ConversationPromptInput): string {
    switch (input.command) {
      case 'explain':
        return `## Task\nExplain the following file or area in the context of this PR: ${input.target ?? '(unspecified — infer from the diff)'}`;
      case 'summarize':
        return '## Task\nSummarize what this pull request does and call out its key risks.';
      default:
        return `## Task\nAnswer this question about the pull request:\n${input.question ?? ''}`;
    }
  }

  private prSection(pr: PullRequestInfo): string {
    return `## Pull request\n#${pr.number} ${pr.title}\n${pr.body?.trim() || '(no description)'}`;
  }

  private targetFileSection(input: ConversationPromptInput): string {
    if (!input.targetFileContent) {
      return '';
    }
    return `## Target file: ${input.target}\n\`\`\`\n${input.targetFileContent.slice(0, MAX_FILE_CHARS)}\n\`\`\``;
  }

  private diffSection(changedFiles: ChangedFileRef[]): string {
    let budget = MAX_DIFF_CHARS;
    const parts: string[] = [];
    for (const file of changedFiles) {
      const block = `### ${file.filename} (${file.status})\n\`\`\`diff\n${file.patch ?? '(no textual diff)'}\n\`\`\``;
      if (block.length > budget) {
        break;
      }
      budget -= block.length;
      parts.push(block);
    }
    return parts.length ? `## Diff\n${parts.join('\n\n')}` : '';
  }

  private contextSection(knowledge: KnowledgeContext): string {
    if (knowledge.relevantChunks.length === 0) {
      return '';
    }
    const chunks = knowledge.relevantChunks
      .map((c) => `### ${c.filePath}:${c.startLine}-${c.endLine}\n${c.content.slice(0, MAX_CHUNK_CHARS)}`)
      .join('\n\n');
    return `## Relevant existing code\n${chunks}`;
  }

  private historySection(history: ConversationMessage[]): string {
    if (history.length <= 1) {
      return '';
    }
    const transcript = history
      .map((m) => `${m.role === 'assistant' ? 'You' : m.authorLogin}: ${m.body.slice(0, MAX_MESSAGE_CHARS)}`)
      .join('\n\n');
    return `## Conversation so far\n${transcript}`;
  }
}
