import { Injectable } from '@nestjs/common';
import { ChangedFileRef } from '../knowledge/knowledge.types';
import { ReviewInlineComment } from '../github/github.types';
import { commentableLinesByFile } from './diff';
import { ReviewFinding, ReviewLlmOutput } from './review.types';

const SEVERITY_EMOJI: Record<ReviewFinding['severity'], string> = {
  critical: '🔴',
  major: '🟠',
  minor: '🟡',
  info: '🔵',
};

export interface MappedReview {
  body: string;
  comments: ReviewInlineComment[];
  inlineFindings: ReviewFinding[];
  generalFindings: ReviewFinding[];
}

// Turns the model's structured output into a GitHub review: findings whose line anchor
// exists in the diff become inline comments; anything else is folded into the summary so
// it is never silently dropped.
@Injectable()
export class ReviewResultMapper {
  map(output: ReviewLlmOutput, changedFiles: ChangedFileRef[]): MappedReview {
    const commentable = commentableLinesByFile(changedFiles);
    const inlineFindings: ReviewFinding[] = [];
    const generalFindings: ReviewFinding[] = [];

    for (const finding of output.findings ?? []) {
      if (commentable.get(finding.path)?.has(finding.line)) {
        inlineFindings.push(finding);
      } else {
        generalFindings.push(finding);
      }
    }

    const comments: ReviewInlineComment[] = inlineFindings.map((finding) => ({
      path: finding.path,
      line: finding.line,
      side: 'RIGHT',
      body: `${SEVERITY_EMOJI[finding.severity]} **${finding.title}**\n\n${finding.body}`,
    }));

    return {
      body: this.buildSummaryBody(output, generalFindings),
      comments,
      inlineFindings,
      generalFindings,
    };
  }

  private buildSummaryBody(output: ReviewLlmOutput, generalFindings: ReviewFinding[]): string {
    const lines = [
      '## 🤖 AI PR Review',
      '',
      `**Inferred intent:** ${output.intent}`,
      '',
      `**Assessment:** ${output.intentAssessment}`,
      '',
      `**Summary:** ${output.summary}`,
      '',
      `_Confidence: ${output.confidence}_`,
    ];

    if (generalFindings.length > 0) {
      lines.push('', '### Additional findings');
      for (const finding of generalFindings) {
        lines.push(
          `- ${SEVERITY_EMOJI[finding.severity]} **${finding.title}** ` +
            `(\`${finding.path}:${finding.line}\`) — ${finding.body}`,
        );
      }
    }

    return lines.join('\n');
  }
}
