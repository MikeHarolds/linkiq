import { PartialType } from '@nestjs/swagger';

import { CreateQrCodeDto } from './create-qr-code.dto';

/** Same fields as creation, all optional — linkId is deliberately not
 * part of either DTO: a QR code's association with a link is fixed at
 * creation time, not re-pointable via update. */
export class UpdateQrCodeDto extends PartialType(CreateQrCodeDto) {}
