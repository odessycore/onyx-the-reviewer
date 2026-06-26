import { ChangedFileRef } from '../knowledge/knowledge.types';
import { ReviewResultMapper } from './review-result.mapper';
import { ReviewLlmOutput } from './review.types';

const changedFiles: ChangedFileRef[] = [
  {
    filename: 'src/app.ts',
    status: 'modified',
    // New file lines 10 and 11 are commentable (context + added).
    patch: '@@ -9,2 +9,3 @@\n const a = 1;\n+const b = 2;\n const c = 3;',
  },
];

const baseOutput: ReviewLlmOutput = {
  summary: 's',
  intent: 'i',
  intentAssessment: 'a',
  confidence: 'high',
  findings: [],
};

describe('ReviewResultMapper', () => {
  const mapper = new ReviewResultMapper();

  it('keeps findings anchored to lines present in the diff as inline comments', () => {
    const output = {
      ...baseOutput,
      findings: [{ path: 'src/app.ts', line: 10, severity: 'major' as const, title: 'T', body: 'B' }],
    };
    const result = mapper.map(output, changedFiles);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({ path: 'src/app.ts', line: 10, side: 'RIGHT' });
    expect(result.generalFindings).toHaveLength(0);
  });

  it('folds findings with off-diff lines into general findings', () => {
    const output = {
      ...baseOutput,
      findings: [{ path: 'src/app.ts', line: 999, severity: 'minor' as const, title: 'T', body: 'B' }],
    };
    const result = mapper.map(output, changedFiles);
    expect(result.comments).toHaveLength(0);
    expect(result.generalFindings).toHaveLength(1);
    expect(result.body).toContain('src/app.ts:999');
  });

  it('folds findings for files outside the diff into general findings', () => {
    const output = {
      ...baseOutput,
      findings: [{ path: 'other.ts', line: 1, severity: 'info' as const, title: 'T', body: 'B' }],
    };
    const result = mapper.map(output, changedFiles);
    expect(result.comments).toHaveLength(0);
    expect(result.generalFindings).toHaveLength(1);
  });
});
