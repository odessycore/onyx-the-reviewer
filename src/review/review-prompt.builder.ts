import { Injectable } from '@nestjs/common';
import { KnowledgeContext } from '../knowledge/knowledge.types';
import { ChangedFileRef } from '../knowledge/knowledge.types';
import { PrIntentSignals } from './review.types';

const MAX_DIFF_CHARS = 45_000;
const MAX_CHUNK_CHARS = 1_500;

const SYSTEM_PROMPT = `You are a meticulous senior software engineer reviewing a GitHub pull request.

First infer the PR's goal from its description, linked issues and commits. Then assess
whether the diff actually accomplishes that goal, and finally review the changed code for
correctness bugs, security issues, missing edge cases, and maintainability problems.

Rules:
- Only raise findings about lines that appear in the provided diff.
- Each finding's "line" MUST be a new-file line number visible in that file's diff hunks.
- Prefer a few high-signal findings over many trivial ones. Do not invent issues.
- If the PR has no description, infer intent from the diff and say so in "intentAssessment".

Return JSON of exactly this shape:
{
  "summary": string,            // what the PR changes, 1-3 sentences
  "intent": string,             // the inferred goal
  "intentAssessment": string,   // does the diff achieve the goal? note any mismatch
  "confidence": "low" | "medium" | "high",
  "findings": [
    { "path": string, "line": number,
      "severity": "info" | "minor" | "major" | "critical",
      "title": string, "body": string }
  ]
}`;

@Injectable()
export class ReviewPromptBuilder {
  build(
    intent: PrIntentSignals,
    knowledge: KnowledgeContext,
    changedFiles: ChangedFileRef[],
  ): { system: string; prompt: string } {
    const sections = [
      this.repoProfileSection(knowledge),
      this.intentSection(intent),
      this.retrievedContextSection(knowledge),
      this.diffSection(changedFiles),
    ];
    return { system: SYSTEM_PROMPT, prompt: sections.filter(Boolean).join('\n\n') };
  }

  private repoProfileSection(knowledge: KnowledgeContext): string {
    const profile = knowledge.profile;
    if (!profile) {
      return '## Repository\n(No repository profile available yet.)';
    }
    const languages = Object.entries(profile.languages)
      .map(([ext, count]) => `${ext}:${count}`)
      .join(', ');
    const manifests = profile.manifests
      .map((manifest) => `### ${manifest.path}\n${manifest.excerpt}`)
      .join('\n');
    return [
      '## Repository profile',
      `Default branch: ${profile.defaultBranch}`,
      `Languages (by file count): ${languages}`,
      `Top-level entries: ${profile.topLevelEntries.join(', ')}`,
      profile.readmeExcerpt ? `### README (excerpt)\n${profile.readmeExcerpt}` : '',
      manifests ? `### Manifests\n${manifests}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private intentSection(intent: PrIntentSignals): string {
    const issues = intent.linkedIssues
      .map((issue) => `- #${issue.number} ${issue.title}\n${issue.body ?? ''}`)
      .join('\n');
    return [
      '## Pull request intent signals',
      `Title: ${intent.title}`,
      `Description:\n${intent.body?.trim() || '(empty)'}`,
      issues ? `Linked issues:\n${issues}` : 'Linked issues: none',
      intent.commitMessages.length
        ? `Commit messages:\n${intent.commitMessages.map((m) => `- ${m.split('\n')[0]}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private retrievedContextSection(knowledge: KnowledgeContext): string {
    if (knowledge.relevantChunks.length === 0) {
      return '';
    }
    const chunks = knowledge.relevantChunks
      .map(
        (chunk) =>
          `### ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}\n` +
          `${chunk.content.slice(0, MAX_CHUNK_CHARS)}`,
      )
      .join('\n\n');
    return `## Relevant existing code (semantic search)\n${chunks}`;
  }

  private diffSection(changedFiles: ChangedFileRef[]): string {
    let budget = MAX_DIFF_CHARS;
    const parts: string[] = [];
    for (const file of changedFiles) {
      const header = `### ${file.filename} (${file.status})`;
      const patch = file.patch ?? '(no textual diff — binary or too large)';
      const block = `${header}\n\`\`\`diff\n${patch}\n\`\`\``;
      if (block.length > budget) {
        parts.push(`${header}\n(diff omitted: exceeds size budget)`);
        continue;
      }
      budget -= block.length;
      parts.push(block);
    }
    return `## Diff under review\n${parts.join('\n\n')}`;
  }
}
