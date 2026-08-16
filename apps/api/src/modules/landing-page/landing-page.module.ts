import { Module } from '@nestjs/common';

import { LandingPageService } from './landing-page.service';

/**
 * Landing Page CMS (Sprint 14). Owns LandingPageService only — the
 * controllers that expose it live elsewhere: AdminModule's
 * AdminLandingPageController (full CRUD, SuperAdminGuard) and
 * PublicModule's PublicController (read-only active content, no
 * auth) — the same "one service, multiple controllers in different
 * modules" shape AdminPlansController already uses with PlansService.
 */
@Module({
  providers: [LandingPageService],
  exports: [LandingPageService],
})
export class LandingPageModule {}
