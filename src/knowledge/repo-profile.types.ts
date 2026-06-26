export interface RepoManifest {
  path: string;
  excerpt: string;
}

export interface RepoProfile {
  defaultBranch: string;
  languages: Record<string, number>;
  topLevelEntries: string[];
  readmeExcerpt?: string;
  contributingExcerpt?: string;
  manifests: RepoManifest[];
  fileCount: number;
}
