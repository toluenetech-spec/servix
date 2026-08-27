import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://servix:servix@127.0.0.1:5432/servix',
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

export const prisma = new PrismaClient({ adapter });
