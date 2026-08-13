import { UnauthorizedException } from '@nestjs/common';

export class ApiKeyExpiredException extends UnauthorizedException {
  constructor() {
    super({
      code: 'API_KEY_EXPIRED',
      message: 'This API key has expired.',
    });
  }
}
