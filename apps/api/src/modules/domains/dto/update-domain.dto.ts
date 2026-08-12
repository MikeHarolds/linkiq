import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { IsValidDomain } from '../validators/is-valid-domain.decorator';

export class UpdateDomainDto {
  @ApiPropertyOptional({
    example: 'go.acme.com',
    description:
      'Corrects the domain hostname. Only allowed while the domain has never been successfully verified (PENDING or FAILED) — resets verification (new token, status back to PENDING). Delete and re-add a domain that is already VERIFIED/ACTIVE/DISABLED instead.',
  })
  @IsOptional()
  @IsString()
  @IsValidDomain()
  domain?: string;
}
