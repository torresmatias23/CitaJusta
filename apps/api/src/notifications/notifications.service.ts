import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedPrincipal } from '../auth/types/authenticated-principal.js';
import { notificationContent } from './notification-content.js';
import { decodeNotificationCursor, encodeNotificationCursor, parseNotification, type NotificationInput, type NotificationQuery } from './notifications.schemas.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  static async create(tx: Prisma.TransactionClient, input: NotificationInput): Promise<void> {
    const data = parseNotification(input);
    // Only PK (fresh UUID) and recipient/event are unique; FK/validation failures propagate.
    // ON CONFLICT DO NOTHING never updates an existing notification or its readAt.
    await tx.notification.createMany({ data: [{ id: randomUUID(), ...data }], skipDuplicates: true });
  }

  async findMine(query: NotificationQuery, principal: AuthenticatedPrincipal) {
    const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.notification.findMany({
        where: { recipientUserId: principal.userId, ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}) }, take: query.limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, type: true, data: true, createdAt: true, readAt: true, resourceType: true, resourceId: true },
      });
      const unreadCount = await tx.notification.count({ where: { recipientUserId: principal.userId, readAt: null } });
      const page = rows.slice(0, query.limit); const last = page.at(-1);
      return { data: page.map(({ data, createdAt, readAt, ...row }) => ({ ...row,
        ...notificationContent({ type: row.type, data }), createdAt: createdAt.toISOString(), readAt: readAt?.toISOString() ?? null })),
        page: { nextCursor: rows.length > query.limit && last ? encodeNotificationCursor(last) : null }, unreadCount };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async unreadCount(principal: AuthenticatedPrincipal) {
    return { data: { unreadCount: await this.prisma.notification.count({ where: { recipientUserId: principal.userId, readAt: null } }) } };
  }

  async read(id: string, principal: AuthenticatedPrincipal) {
    // Concurrent readers preserve the first committed timestamp through the IS NULL predicate.
    await this.prisma.notification.updateMany({ where: { id, recipientUserId: principal.userId, readAt: null }, data: { readAt: new Date() } });
    const row = await this.prisma.notification.findFirst({ where: { id, recipientUserId: principal.userId }, select: { id: true, readAt: true } });
    if (!row) throw new NotFoundException('Notification not found');
    return { data: { id: row.id, readAt: row.readAt?.toISOString() ?? null } };
  }
}
