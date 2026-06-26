import { Injectable } from '@nestjs/common';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { AppConfigService } from '../config/app-config.service';

// Produces installation-scoped Octokit clients. Octokit's app auth strategy mints and
// caches/refreshes installation access tokens internally, so we cache one client per
// installation and reuse it.
@Injectable()
export class GithubClientFactory {
  private readonly clients = new Map<number, Octokit>();

  constructor(private readonly config: AppConfigService) {}

  forInstallation(installationId: number): Octokit {
    const cached = this.clients.get(installationId);
    if (cached) {
      return cached;
    }
    const client = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.config.github.appId,
        privateKey: this.config.github.privateKey,
        installationId,
      },
    });
    this.clients.set(installationId, client);
    return client;
  }
}
