/** Small helpers over the users table (participantId <-> display names). */
import type { User } from '@prisma/client';
import type { AppContext } from '../context.js';

export class UserDirectory {
  private cache = new Map<string, User | null>();
  constructor(private readonly ctx: AppContext) {}
  async byParticipant(participantId: string): Promise<User | null> {
    if (this.cache.has(participantId)) return this.cache.get(participantId) ?? null;
    const u = await this.ctx.db.user.findUnique({ where: { participantId } });
    this.cache.set(participantId, u);
    return u;
  }
  async name(participantId: string): Promise<string> { return (await this.byParticipant(participantId))?.name ?? participantId; }
  async vpa(participantId: string): Promise<string> { return (await this.byParticipant(participantId))?.vpa ?? `${participantId}@upi`; }
}

export async function findUserByParticipant(ctx: AppContext, participantId: string): Promise<User | null> {
  return ctx.db.user.findUnique({ where: { participantId } });
}
