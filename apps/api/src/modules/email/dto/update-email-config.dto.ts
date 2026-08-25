import { ApiPropertyOptional } from '@nestjs/swagger';
import { EmailProviderKind, SmtpEncryptionMode } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateEmailConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: EmailProviderKind })
  @IsOptional()
  @IsEnum(EmailProviderKind)
  provider?: EmailProviderKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  fromEmail?: string;

  @ApiPropertyOptional({
    description:
      'Set to replace the stored Resend API key. Omit to leave unchanged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resendApiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpHost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpUsername?: string;

  @ApiPropertyOptional({
    description:
      'Set to replace the stored SMTP password. Omit to leave unchanged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  smtpPassword?: string;

  @ApiPropertyOptional({ enum: SmtpEncryptionMode })
  @IsOptional()
  @IsEnum(SmtpEncryptionMode)
  smtpEncryptionMode?: SmtpEncryptionMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireEmailVerification?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  welcomeEmailsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  verificationEmailsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  passwordResetEmailsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reportEmailsEnabled?: boolean;
}
