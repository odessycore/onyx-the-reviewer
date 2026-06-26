import { RepoProfile } from './repo-profile.types';

export interface RetrievedChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
}

export interface ChangedFileContent {
  path: string;
  content: string;
}

export interface KnowledgeContext {
  profile: RepoProfile | null;
  relevantChunks: RetrievedChunk[];
  changedFileContents: ChangedFileContent[];
}

export interface ChangedFileRef {
  filename: string;
  status: string;
  patch?: string;
}
