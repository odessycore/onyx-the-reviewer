import { extractJson } from './json';

describe('extractJson', () => {
  it('parses bare JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts JSON from a fenced block', () => {
    const text = 'Here is the result:\n```json\n{"ok": true}\n```\nThanks!';
    expect(extractJson(text)).toEqual({ ok: true });
  });

  it('extracts JSON surrounded by prose', () => {
    expect(extractJson('Sure! {"name": "x", "n": 2} done')).toEqual({ name: 'x', n: 2 });
  });

  it('handles braces inside strings', () => {
    expect(extractJson('{"text": "a } b { c"}')).toEqual({ text: 'a } b { c' });
  });

  it('parses arrays', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('throws when no JSON present', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});
