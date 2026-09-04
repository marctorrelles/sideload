// worker/src/stats-do.ts
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import type { StatsView } from '@shared/types';
export class StatsDO extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS runs (at INTEGER NOT NULL, moved INTEGER NOT NULL, total INTEGER NOT NULL, seconds INTEGER NOT NULL)',
    );
  }
  async add(p: { moved: number; total: number; seconds: number }): Promise<void> {
    this.sql.exec(
      'INSERT INTO runs (at, moved, total, seconds) VALUES (?,?,?,?)',
      Date.now(),
      p.moved | 0,
      p.total | 0,
      p.seconds | 0,
    );
  }
  async get(): Promise<StatsView> {
    const a = this.sql
      .exec('SELECT COUNT(*) AS jobs, COALESCE(SUM(moved),0) AS moved, COALESCE(SUM(total),0) AS total FROM runs')
      .one() as { jobs: number; moved: number; total: number };
    const secs = (
      this.sql.exec('SELECT seconds FROM runs WHERE total >= 100 ORDER BY seconds').toArray() as { seconds: number }[]
    ).map((r) => r.seconds);
    const median = !secs.length
      ? null
      : secs.length % 2
        ? secs[(secs.length - 1) / 2]!
        : (secs[secs.length / 2 - 1]! + secs[secs.length / 2]!) / 2;
    return {
      tracksMoved: a.moved,
      jobs: a.jobs,
      matchRate: a.total ? a.moved / a.total : null,
      medianMinutes: median === null ? null : Math.round(median / 60),
    };
  }
}
