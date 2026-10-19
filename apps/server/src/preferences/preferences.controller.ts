import { Body, Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import type { PreferencePatch } from '@protocol';
import type { Principal } from '../auth/security.js';
import { CurrentPrincipal } from '../http/current-principal.js';
import { PrincipalGuard } from '../http/principal.guard.js';
import { PreferenceService } from './service.js';

@Controller('preferences')
@UseGuards(PrincipalGuard)
export class PreferencesController {
  constructor(@Inject(PreferenceService) private readonly preferences: PreferenceService) {}

  @Get()
  async get(@CurrentPrincipal() p: Principal) {
    return this.preferences.get(p);
  }

  @Patch()
  async update(@CurrentPrincipal() p: Principal, @Body() input: PreferencePatch) {
    return this.preferences.update(p, input);
  }
}
