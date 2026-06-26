import { ParsedCommand } from './conversation.types';

// Parses a comment that has already been deemed bot-directed. A leading slash selects a
// command; anything else is treated as a free-form question (`ask`).
export const parseCommand = (body: string, mentionHandle: string): ParsedCommand => {
  const cleaned = body.split(mentionHandle).join('').trim();

  if (!cleaned.startsWith('/')) {
    return { command: 'ask', question: cleaned };
  }

  const withoutSlash = cleaned.slice(1);
  const [word, ...rest] = withoutSlash.split(/\s+/);
  const remainder = rest.join(' ').trim();

  switch (word.toLowerCase()) {
    case 'review':
      return { command: 'review', focus: extractFocus(remainder) };
    case 'explain':
      return { command: 'explain', target: remainder || undefined };
    case 'summarize':
    case 'summarise':
      return { command: 'summarize' };
    default:
      // Unknown slash command — fall back to answering it as a question.
      return { command: 'ask', question: cleaned };
  }
};

const extractFocus = (remainder: string): string | undefined => {
  const match = remainder.match(/--focus[=\s]+(.+)/i);
  return match ? match[1].trim() : undefined;
};
