import { join } from 'path';

import { registerAs } from '@nestjs/config';

export default registerAs('branding', () => ({
  /** Where uploaded logo/favicon files are written on disk. Defaults
   * to <repo>/apps/api/uploads — see main.ts's static-serving setup,
   * which serves this same directory at /uploads. */
  uploadDir: process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'),
  /** The API's own publicly-reachable origin, used to build absolute
   * URLs for uploaded files (e.g. "http://localhost:4000/uploads/
   * branding/<file>"). Distinct from APP_URL, which is the WEB
   * frontend's origin. */
  publicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
}));
