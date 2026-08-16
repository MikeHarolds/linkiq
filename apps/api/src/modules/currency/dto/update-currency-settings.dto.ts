import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateCurrencySettingsDto {
  @ApiPropertyOptional({ description: 'Currency shown when no other signal is available' })
  @IsOptional()
  @IsUUID()
  defaultCurrencyId?: string;

  @ApiPropertyOptional({
    description:
      'Used whenever detection fails, is disabled, or resolves to an inactive/unsupported currency',
  })
  @IsOptional()
  @IsUUID()
  fallbackCurrencyId?: string;

  @ApiPropertyOptional({ description: 'Whether GeoIP-based currency detection runs at all' })
  @IsOptional()
  @IsBoolean()
  autoDetectEnabled?: boolean;
}
