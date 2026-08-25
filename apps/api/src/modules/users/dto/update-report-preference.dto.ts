import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportDay, ReportFrequency } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdateReportPreferenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailReportsEnabled?: boolean;

  @ApiPropertyOptional({ enum: ReportFrequency })
  @IsOptional()
  @IsEnum(ReportFrequency)
  frequency?: ReportFrequency;

  @ApiPropertyOptional({
    enum: ReportDay,
    description: 'Required (and only meaningful) when frequency is WEEKLY.',
  })
  @ValidateIf((o: UpdateReportPreferenceDto) => o.frequency === ReportFrequency.WEEKLY)
  @IsEnum(ReportDay)
  reportDay?: ReportDay;

  @ApiPropertyOptional({ minimum: 0, maximum: 23, description: 'Hour of day, UTC.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reportHourUtc?: number;
}
