import { ChangedFileRef } from '../knowledge/knowledge.types';

// New-file line numbers that GitHub will accept as inline review-comment anchors
// (added and context lines on the RIGHT side of the diff), keyed by file path.
export const commentableLinesByFile = (files: ChangedFileRef[]): Map<string, Set<number>> => {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    if (file.patch) {
      map.set(file.filename, rightSideLines(file.patch));
    }
  }
  return map;
};

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const rightSideLines = (patch: string): Set<number> => {
  const lines = new Set<number>();
  let newLine = 0;
  for (const row of patch.split('\n')) {
    const header = row.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (row.startsWith('-')) {
      continue;
    }
    if (row.startsWith('+') || row.startsWith(' ')) {
      lines.add(newLine);
      newLine++;
    }
  }
  return lines;
};
