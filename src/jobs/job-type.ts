export const JobType = {
  BootstrapRepository: 'bootstrap_repository',
  RefreshIndex: 'refresh_index',
  ReviewPullRequest: 'review_pull_request',
  PrCommand: 'pr_command',
} as const;

export type JobType = (typeof JobType)[keyof typeof JobType];
