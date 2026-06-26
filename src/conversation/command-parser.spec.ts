import { parseCommand } from './command-parser';

const MENTION = '@onyx-the-reviewer';

describe('parseCommand', () => {
  it('parses /review', () => {
    expect(parseCommand('/review', MENTION)).toEqual({ command: 'review', focus: undefined });
  });

  it('parses /review --focus security', () => {
    expect(parseCommand('/review --focus security', MENTION)).toEqual({
      command: 'review',
      focus: 'security',
    });
  });

  it('parses /review --focus=performance', () => {
    expect(parseCommand('/review --focus=performance', MENTION).focus).toBe('performance');
  });

  it('parses /explain with a target path', () => {
    expect(parseCommand('/explain src/auth/session.ts', MENTION)).toEqual({
      command: 'explain',
      target: 'src/auth/session.ts',
    });
  });

  it('parses /summarize (and British spelling)', () => {
    expect(parseCommand('/summarize', MENTION).command).toBe('summarize');
    expect(parseCommand('/summarise', MENTION).command).toBe('summarize');
  });

  it('treats a mention without a slash as a free-form question', () => {
    expect(parseCommand('@onyx-the-reviewer why is this O(n^2)?', MENTION)).toEqual({
      command: 'ask',
      question: 'why is this O(n^2)?',
    });
  });

  it('treats an unknown slash command as a question', () => {
    expect(parseCommand('/foobar do a thing', MENTION).command).toBe('ask');
  });
});
