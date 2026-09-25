import type { Owner } from './auth.ts';
import type { Bindings } from './lib.ts';

/** The Hono environment every router shares (index.ts and the crm-*.ts sub-apps). */
export type AppEnv = { Bindings: Bindings; Variables: { owner: Owner } };
