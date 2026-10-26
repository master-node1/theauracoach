import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { consentInputSchema, type ConsentRecord, type ConsentResponse } from '@aura/contracts';
import { CurrentUser, ZodValidationPipe, type AuthenticatedUser } from '@aura/service-kit';
import { ConsentsService } from './consents.service';

@Controller('v1/me/consents')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Get()
  list(@CurrentUser() identity: AuthenticatedUser): Promise<ConsentResponse[]> {
    return this.consents.latest(identity);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  record(
    @CurrentUser() identity: AuthenticatedUser,
    @Body(new ZodValidationPipe(consentInputSchema)) body: ConsentRecord,
  ): Promise<ConsentResponse> {
    return this.consents.record(identity, body);
  }
}
