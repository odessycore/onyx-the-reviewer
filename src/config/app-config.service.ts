import { Injectable } from '@nestjs/common';
import { AppConfig, loadAppConfig } from './env.schema';

@Injectable()
export class AppConfigService {
  private readonly config: AppConfig = loadAppConfig();

  get port(): number {
    return this.config.port;
  }

  get nodeEnv(): AppConfig['nodeEnv'] {
    return this.config.nodeEnv;
  }

  get github(): AppConfig['github'] {
    return this.config.github;
  }

  // GitHub renders an app's comments under the login `<slug>[bot]`; @mentions use `@<slug>`.
  get botLogin(): string {
    return `${this.config.github.slug}[bot]`;
  }

  get mentionHandle(): string {
    return `@${this.config.github.slug}`;
  }

  get llm(): AppConfig['llm'] {
    return this.config.llm;
  }

  get embedding(): AppConfig['embedding'] {
    return this.config.embedding;
  }

  get worker(): AppConfig['worker'] {
    return this.config.worker;
  }

  get encryptionKey(): string {
    return this.config.encryptionKey;
  }

  get adminApiToken(): string | undefined {
    return this.config.adminApiToken;
  }
}
