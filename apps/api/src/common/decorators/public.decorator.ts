import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring authentication. The global JwtAuthGuard
 * checks for this metadata and skips token validation when present.
 *
 * @example
 * ```ts
 * @Public()
 * @Post('login')
 * login(@Body() dto: LoginDto) { ... }
 * ```
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
