export interface WebhookAccount {
  login: string;
  type: string;
}

export interface WebhookRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner?: { login: string };
}

export interface WebhookInstallationRef {
  id: number;
  account?: WebhookAccount;
}

export interface InstallationEvent {
  action: string;
  installation: WebhookInstallationRef;
  repositories?: Array<Pick<WebhookRepository, 'id' | 'name' | 'full_name' | 'private'>>;
  repositories_added?: Array<Pick<WebhookRepository, 'id' | 'name' | 'full_name' | 'private'>>;
}

export interface PullRequestEvent {
  action: string;
  installation: WebhookInstallationRef;
  repository: WebhookRepository;
  pull_request: {
    number: number;
    draft?: boolean;
    head: { sha: string };
  };
}

export interface PushEvent {
  ref: string;
  after: string;
  installation: WebhookInstallationRef;
  repository: WebhookRepository;
}

export interface WebhookCommentUser {
  login: string;
  type: string;
}

export interface IssueCommentEvent {
  action: string;
  installation: WebhookInstallationRef;
  repository: WebhookRepository;
  issue: { number: number; pull_request?: unknown };
  comment: { id: number; body: string; user: WebhookCommentUser };
}

export interface ReviewCommentEvent {
  action: string;
  installation: WebhookInstallationRef;
  repository: WebhookRepository;
  pull_request: { number: number };
  comment: {
    id: number;
    body: string;
    path?: string;
    in_reply_to_id?: number;
    user: WebhookCommentUser;
  };
}
