export interface PullRequestInfo {
  number: number;
  title: string;
  body: string | null;
  state: string;
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  githubId: number;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface RepoTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string | null;
}

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

export interface ReviewInlineComment {
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
}

export interface CreateReviewInput {
  owner: string;
  repo: string;
  pullNumber: number;
  commitId: string;
  body: string;
  event: ReviewEvent;
  comments: ReviewInlineComment[];
}
