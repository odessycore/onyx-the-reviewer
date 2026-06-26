import { Injectable } from '@nestjs/common';
import { GithubApiService } from '../github/github-api.service';
import { PullRequestInfo } from '../github/github.types';
import { PrIntentSignals } from './review.types';

const ISSUE_REFERENCE = /(?:close[sd]?|fixe?[sd]?|resolve[sd]?)\s+#(\d+)/gi;
const PLAIN_REFERENCE = /#(\d+)/g;
const MAX_LINKED_ISSUES = 5;
const MAX_COMMITS = 20;

// Gathers the raw signals that describe a PR's goal, in reliability order: the
// description, the issues it closes, then commit messages. The model infers intent from these.
@Injectable()
export class PrIntentService {
  constructor(private readonly github: GithubApiService) {}

  async collect(
    installationGithubId: number,
    owner: string,
    repo: string,
    pr: PullRequestInfo,
  ): Promise<PrIntentSignals> {
    const issueNumbers = this.extractIssueNumbers(`${pr.title}\n${pr.body ?? ''}`);
    const linkedIssues = [];
    for (const number of issueNumbers.slice(0, MAX_LINKED_ISSUES)) {
      const issue = await this.github.getIssue(installationGithubId, owner, repo, number);
      if (issue) {
        linkedIssues.push(issue);
      }
    }

    const commitMessages = (
      await this.github.getPullRequestCommitMessages(installationGithubId, owner, repo, pr.number)
    ).slice(0, MAX_COMMITS);

    return { title: pr.title, body: pr.body, linkedIssues, commitMessages };
  }

  private extractIssueNumbers(text: string): number[] {
    const closing = [...text.matchAll(ISSUE_REFERENCE)].map((match) => Number(match[1]));
    const plain = [...text.matchAll(PLAIN_REFERENCE)].map((match) => Number(match[1]));
    return [...new Set([...closing, ...plain])];
  }
}
