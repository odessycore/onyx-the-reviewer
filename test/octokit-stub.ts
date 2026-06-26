// Stub for the ESM-only @octokit/* packages under Jest's CommonJS runtime. The e2e test
// overrides GithubApiService, so these are never actually invoked — they only need to import.
export class Octokit {}
export function createAppAuth(): unknown {
  return {};
}
