import { UnauthorizedException } from '@nestjs/common';

/** Malformed, unrecognized, or not-found key — also used for a key whose
 * creator no longer exists/is inactive, mirroring JwtStrategy's identical
 * "deleted/deactivated user" handling for JWTs. */
export class InvalidApiKeyException extends UnauthorizedException {
  constructor() {
    super({
      code: 'INVALID_API_KEY',
      message: 'The API key is invalid or expired.',
    });
  }
}
