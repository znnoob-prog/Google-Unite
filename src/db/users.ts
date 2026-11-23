import { eq, desc, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { auditLogs, chatSpaces, users } from './schema.ts';

export type DbUser = typeof users.$inferSelect;

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string,
  photoUrl?: string
): Promise<DbUser> {
  try {
    // Check if any admin exists yet; first user or primary workspace owner gets admin role
    const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (existing.length > 0) {
      const updated = await db
        .update(users)
        .set({
          email,
          displayName: displayName || existing[0].displayName,
          photoUrl: photoUrl || existing[0].photoUrl,
        })
        .where(eq(users.uid, uid))
        .returning();
      return updated[0];
    }

    const totalUsers = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const isFirstUser = (totalUsers[0]?.count ?? 0) === 0;
    const role = isFirstUser ? 'admin' : 'member';

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName || email.split('@')[0] || 'User',
        photoUrl: photoUrl || '',
        role,
        connectedServices: [],
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName: displayName || email.split('@')[0] || 'User',
          photoUrl: photoUrl || '',
        },
      })
      .returning();

    const createdUser = inserted[0];

    // Ensure default General chat space exists
    await db
      .insert(chatSpaces)
      .values({
        slug: 'general',
        name: 'General Workspace',
        description: 'Cross-functional channel for all Google Unite accounts.',
        createdByUserId: createdUser.id,
      })
      .onConflictDoNothing({ target: chatSpaces.slug });

    return createdUser;
  } catch (error) {
    console.error('Database error in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function getAllUsers(): Promise<DbUser[]> {
  try {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  } catch (error) {
    console.error('Database error in getAllUsers:', error);
    throw new Error('Failed to retrieve user directory.', { cause: error });
  }
}

export async function updateUserRole(targetUserId: number, role: 'admin' | 'member'): Promise<DbUser | null> {
  try {
    const updated = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, targetUserId))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database error in updateUserRole:', error);
    throw new Error('Failed to update user role.', { cause: error });
  }
}

export async function updateUserSyncStatus(userId: number, services: string[]): Promise<DbUser | null> {
  try {
    const updated = await db
      .update(users)
      .set({
        connectedServices: services,
        lastSyncedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database error in updateUserSyncStatus:', error);
    throw new Error('Failed to update user sync status.', { cause: error });
  }
}

export async function recordAuditLog(
  userId: number | null,
  actorEmail: string,
  action: string,
  service: string,
  detail: string
) {
  try {
    const inserted = await db
      .insert(auditLogs)
      .values({
        userId,
        actorEmail,
        action,
        service,
        detail,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database error in recordAuditLog:', error);
    return null;
  }
}

export async function getRecentAuditLogs(userId: number, isAdmin: boolean) {
  try {
    if (isAdmin) {
      return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(60);
    }
    return await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(40);
  } catch (error) {
    console.error('Database error in getRecentAuditLogs:', error);
    throw new Error('Failed to load activity logs.', { cause: error });
  }
}
