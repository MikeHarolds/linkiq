import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QrErrorCorrectionLevel, QrFormat } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import {
  QR_MARGIN_MAX,
  QR_MARGIN_MIN,
  QR_SIZE_MAX,
  QR_SIZE_MIN,
} from '../utils/qr-validation';

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class CreateQrCodeDto {
  @ApiProperty({ example: 'Summer Campaign QR' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ enum: QrFormat, default: QrFormat.PNG })
  @IsOptional()
  @IsEnum(QrFormat)
  format?: QrFormat;

  @ApiPropertyOptional({
    minimum: QR_SIZE_MIN,
    maximum: QR_SIZE_MAX,
    default: 512,
  })
  @IsOptional()
  @IsInt()
  @Min(QR_SIZE_MIN)
  @Max(QR_SIZE_MAX)
  size?: number;

  @ApiPropertyOptional({ example: '#000000', default: '#000000' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_REGEX, {
    message: 'foregroundColor must be a valid hex color',
  })
  foregroundColor?: string;

  @ApiPropertyOptional({ example: '#FFFFFF', default: '#FFFFFF' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_REGEX, {
    message: 'backgroundColor must be a valid hex color',
  })
  backgroundColor?: string;

  @ApiPropertyOptional({
    enum: QrErrorCorrectionLevel,
    default: QrErrorCorrectionLevel.M,
  })
  @IsOptional()
  @IsEnum(QrErrorCorrectionLevel)
  errorCorrectionLevel?: QrErrorCorrectionLevel;

  @ApiPropertyOptional({
    minimum: QR_MARGIN_MIN,
    maximum: QR_MARGIN_MAX,
    default: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(QR_MARGIN_MIN)
  @Max(QR_MARGIN_MAX)
  margin?: number;
}
