import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class ExtendTrialDto {
  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsISO8601()
  trialEnd!: string;
}
