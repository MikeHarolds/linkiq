import { PartialType, OmitType } from '@nestjs/swagger';

import { CreateRoleDto } from './create-role.dto';

/** Slug is immutable once created (see CreateRoleDto's own docs) — never
 * part of an update payload. Every other field is a partial update,
 * mirroring UpdatePlanDto's own convention. */
export class UpdateRoleDto extends PartialType(OmitType(CreateRoleDto, ['slug'] as const)) {}
