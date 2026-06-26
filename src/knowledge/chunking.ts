export interface SourceChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
}

const CHUNK_LINES = 60;
const OVERLAP_LINES = 10;

const INDEXABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rb', 'rs', 'java', 'kt', 'kts',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'swift', 'scala', 'sh', 'bash', 'sql',
  'vue', 'svelte', 'md', 'mdx', 'yaml', 'yml', 'toml', 'json',
]);

const IGNORED_PATH_SEGMENTS = [
  'node_modules/', 'dist/', 'build/', 'vendor/', '.git/', 'coverage/',
  '__snapshots__/', '.next/', 'target/',
];

const IGNORED_FILENAME_PATTERNS = [/\.min\.js$/, /\.lock$/, /-lock\.json$/, /\.map$/];

export const MAX_INDEXABLE_FILE_BYTES = 200_000;

export const isIndexablePath = (path: string): boolean => {
  if (IGNORED_PATH_SEGMENTS.some((segment) => path.includes(segment))) {
    return false;
  }
  if (IGNORED_FILENAME_PATTERNS.some((pattern) => pattern.test(path))) {
    return false;
  }
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return INDEXABLE_EXTENSIONS.has(extension);
};

// Splits a file into overlapping line-windows so a retrieved chunk carries enough
// surrounding context to be meaningful on its own.
export const chunkFile = (filePath: string, content: string): SourceChunk[] => {
  const lines = content.split('\n');
  if (lines.length === 0) {
    return [];
  }

  const chunks: SourceChunk[] = [];
  const step = CHUNK_LINES - OVERLAP_LINES;
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + CHUNK_LINES, lines.length);
    const slice = lines.slice(start, end).join('\n').trim();
    if (slice.length > 0) {
      chunks.push({ filePath, startLine: start + 1, endLine: end, content: slice });
    }
    if (end === lines.length) {
      break;
    }
  }
  return chunks;
};
