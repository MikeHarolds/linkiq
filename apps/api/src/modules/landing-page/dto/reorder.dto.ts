import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** The full set of ids for one resource, in the desired display order.
 * sortOrder is reassigned sequentially (0, 1, 2, ...) from this array —
 * see LandingPageService.reorder(). The caller must submit every id
 * (not a partial reorder), since a partial list would leave the
 * omitted rows' relative order ambiguous. */
export class ReorderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
