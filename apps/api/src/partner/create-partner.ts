import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createDatabase } from '../db/client';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password';
import { PgPartnerStore } from './pg-partner.store';

const input = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'use lower case letters, digits and hyphens'),
  name: z.string().trim().min(2).max(80),
  category: z.enum(['shop', 'travel']),
  email: z.string().trim().toLowerCase().email(),
  staff: z.string().trim().min(2).max(80),
});

/**
 * Creates a partner, if new, and an owner account for it. There is no self-sign-up: partners are
 * added by hand once they have signed. The password comes from the environment so it stays out of
 * shell history.
 */
async function main() {
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      name: { type: 'string' },
      category: { type: 'string' },
      email: { type: 'string' },
      staff: { type: 'string' },
    },
  });
  const args = input.parse(values);
  const url = process.env.DATABASE_URL;
  const password = process.env.PARTNER_PASSWORD;
  if (!url) throw new Error('Set DATABASE_URL.');
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Set PARTNER_PASSWORD to ${MIN_PASSWORD_LENGTH}+ characters.`);
  }
  const { db, close } = createDatabase(url);
  try {
    const store = new PgPartnerStore(db);
    await store.ensurePartner({ id: args.id, name: args.name, category: args.category });
    await store.createStaff({
      partnerId: args.id,
      email: args.email,
      name: args.staff,
      role: 'owner',
      passwordHash: await hashPassword(password),
    });
    console.log(`Partner ${args.id} is ready; ${args.email} can sign in.`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
