import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { IsValidDomain } from '../validators/is-valid-domain.decorator';

export class CreateDomainDto {
  @ApiProperty({ example: 'go.acme.com' })
  @IsString()
  @IsValidDomain()
  domain!: string;
}
