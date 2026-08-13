import { UnauthorizedException } from '@nestjs/common';

export class ApiKeyRevokedException extends UnauthorizedException {
  constructor() {
    super({
      code: 'API_KEY_REVOKED',
      message: 'This API key has been revoked.',
    });
  }
}
