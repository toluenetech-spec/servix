import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { serializeCategory } from '../lib/serialize.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.get(
    '/categories',
    { schema: { tags: ['catalogue'], summary: 'List active service categories' } },
    async () => {
      const rows = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { position: 'asc' },
      });
      return rows.map(serializeCategory);
    },
  );
}
