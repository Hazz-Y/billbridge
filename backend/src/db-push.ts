/** `npm run prisma:push` — works without a .env (defaults DATABASE_URL=file:./dev.db). */
import { config } from './config.js';
import { pushSchema } from './db.js';
pushSchema(config.databaseUrl);
