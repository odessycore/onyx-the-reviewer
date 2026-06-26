import { Injectable } from '@nestjs/common';
import { GithubApiService } from '../github/github-api.service';
import { RepoTreeEntry } from '../github/github.types';
import { RepoManifest, RepoProfile } from './repo-profile.types';

const README_CANDIDATES = ['README.md', 'README.rst', 'README.txt', 'readme.md'];
const CONTRIBUTING_CANDIDATES = ['CONTRIBUTING.md', 'docs/CONTRIBUTING.md'];
const MANIFEST_FILES = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'tsconfig.json',
];
const EXCERPT_LIMIT = 2000;

const truncate = (value: string): string =>
  value.length > EXCERPT_LIMIT ? `${value.slice(0, EXCERPT_LIMIT)}\n...[truncated]` : value;

// Builds a compact, cached "repo card" used in every review prompt. Deterministic and
// cheap (no LLM) so it can refresh on every push to the default branch.
@Injectable()
export class RepoProfileService {
  constructor(private readonly github: GithubApiService) {}

  async buildProfile(
    installationGithubId: number,
    owner: string,
    repo: string,
    defaultBranch: string,
    ref: string,
    tree: RepoTreeEntry[],
  ): Promise<RepoProfile> {
    const blobs = tree.filter((entry) => entry.type === 'blob');

    return {
      defaultBranch,
      languages: this.countLanguages(blobs),
      topLevelEntries: this.topLevelEntries(tree),
      readmeExcerpt: await this.firstExisting(installationGithubId, owner, repo, README_CANDIDATES, ref),
      contributingExcerpt: await this.firstExisting(
        installationGithubId, owner, repo, CONTRIBUTING_CANDIDATES, ref,
      ),
      manifests: await this.collectManifests(installationGithubId, owner, repo, blobs, ref),
      fileCount: blobs.length,
    };
  }

  private countLanguages(blobs: RepoTreeEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const blob of blobs) {
      const extension = blob.path.split('.').pop()?.toLowerCase();
      if (extension && extension.length <= 5) {
        counts[extension] = (counts[extension] ?? 0) + 1;
      }
    }
    return Object.fromEntries(
      Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 12),
    );
  }

  private topLevelEntries(tree: RepoTreeEntry[]): string[] {
    const entries = new Set<string>();
    for (const entry of tree) {
      entries.add(entry.path.split('/')[0]);
    }
    return [...entries].sort().slice(0, 40);
  }

  private async firstExisting(
    installationGithubId: number,
    owner: string,
    repo: string,
    candidates: string[],
    ref: string,
  ): Promise<string | undefined> {
    for (const path of candidates) {
      const content = await this.github.getFileContent(installationGithubId, owner, repo, path, ref);
      if (content) {
        return truncate(content);
      }
    }
    return undefined;
  }

  private async collectManifests(
    installationGithubId: number,
    owner: string,
    repo: string,
    blobs: RepoTreeEntry[],
    ref: string,
  ): Promise<RepoManifest[]> {
    const present = new Set(blobs.map((blob) => blob.path));
    const manifests: RepoManifest[] = [];
    for (const path of MANIFEST_FILES) {
      if (!present.has(path)) {
        continue;
      }
      const content = await this.github.getFileContent(installationGithubId, owner, repo, path, ref);
      if (content) {
        manifests.push({ path, excerpt: truncate(content) });
      }
    }
    return manifests;
  }
}
