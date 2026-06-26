import { BadRequestException, Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminTokenGuard } from './admin-token.guard';
import { InstallationsService } from './installations.service';

const settingsSchema = z
  .object({
    llmProvider: z.string().min(1).optional(),
    llmModel: z.string().min(1).optional(),
    llmApiKey: z.string().nullable().optional(),
    embeddingBaseUrl: z.string().url().optional(),
    embeddingModel: z.string().min(1).optional(),
    embeddingApiKey: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

@Controller('installations')
@UseGuards(AdminTokenGuard)
export class InstallationsController {
  constructor(private readonly installations: InstallationsService) {}

  @Get()
  list() {
    return this.installations.listInstallations();
  }

  @Patch(':githubInstallationId/settings')
  async updateSettings(
    @Param('githubInstallationId') githubInstallationId: string,
    @Body() body: unknown,
  ) {
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const installation = await this.installations.updateSettings(
      Number(githubInstallationId),
      parsed.data,
    );
    return { id: installation.id, enabled: installation.enabled };
  }
}
