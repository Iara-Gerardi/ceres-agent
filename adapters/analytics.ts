import { z } from 'zod';
import type { Pool } from 'pg';
import { metricSchema, type AnalyticsAdapter, type ProjectConfig, type Metric } from '../core/contracts.ts';

export const eventSchema = z.object({ visitor: z.string().min(1), session: z.string().min(1), event: z.string().min(1), group: z.string().nullable(), at: z.iso.datetime() }).strict();
export type Event = z.infer<typeof eventSchema>;
export class EventAnalytics implements AnalyticsAdapter {
  constructor(private load: (config: ProjectConfig, start: string, end: string) => Promise<Event[]>) {}
  async read(config: ProjectConfig, period: {start:string;end:string}) {
    const rows = z.array(eventSchema).max(10000).parse(await this.load(config, period.start, period.end));
    const metrics: Metric[] = []; const failures: string[] = [];
    const p = config.analytics; const cutoff = Date.parse(period.end);
    if (!rows.some(x => x.event === p.event)) throw new Error('Required analytics events unavailable');
    for (const group of p.groups) {
      const visits = rows.filter(x => x.event === p.event && x.group === group && Date.parse(x.at) >= Date.parse(period.start) && Date.parse(x.at) < cutoff);
      const unique = [...new Set(visits.map(x => x.visitor))];
      for (const hours of [0, ...p.windows_hours]) {
        if (hours > 0 && !p.identity_linking) { failures.push(`${group}/${hours}h: identity linking unavailable`); continue; }
        const eligible = unique.filter(v => !hours || visits.some(x => x.visitor === v && Date.parse(x.at) + hours * 3600000 <= cutoff));
        const converted = eligible.filter(v => rows.some(c => c.event === p.conversion && c.visitor === v && Date.parse(c.at) < cutoff && visits.some(x => x.visitor === v && Date.parse(x.at) <= Date.parse(c.at) && (hours === 0 ? x.session === c.session : Date.parse(x.at) + hours * 3600000 <= cutoff && Date.parse(c.at) <= Date.parse(x.at) + hours * 3600000))));
        metrics.push(metricSchema.parse({ metric: `${group}/${hours ? hours + 'h' : 'same-session'}`, value: eligible.length ? converted.length / eligible.length : null, unit: 'fraction', numerator: converted.length, denominator: eligible.length, population: `Unique visitors to ${group}; groups may overlap`, period }));
      }
    }
    const relevant = rows.filter(x => [p.event,p.conversion].includes(x.event) && Date.parse(x.at) >= Date.parse(period.start) && Date.parse(x.at) < cutoff);
    return { metrics, snapshot: { events: rows, parameters: p, period, sample: config.sample }, usage: { used: relevant.length, read: rows.length, exclusions: relevant.length === rows.length ? [] : [`${rows.length-relevant.length} rows outside the event definitions or analysis period`] }, failures };
  }
}
/** Query text and event mappings are server configuration, never model-provided SQL. */
export function postgresAnalytics(pool: Pool, query: string): EventAnalytics {
  return new EventAnalytics(async (_config, start, end) => {
    if (query.length > 10000 || !/^select\b/i.test(query.trim()) || query.includes(';')) throw new Error('Invalid analytics definition');
    const c = await pool.connect();
    try {
      await c.query('BEGIN READ ONLY');
      await c.query("SET LOCAL statement_timeout = '5s'");
      await c.query("SET LOCAL lock_timeout = '1s'");
      await c.query(`DECLARE ceres_rows NO SCROLL CURSOR FOR ${query}`, [start, end]);
      const result = await c.query('FETCH FORWARD 10001 FROM ceres_rows');
      if (result.rows.length > 10000) throw new Error('Analytics row limit exceeded');
      await c.query('COMMIT'); return result.rows;
    } catch { await c.query('ROLLBACK'); throw new Error('Analytics unavailable or query limit exceeded'); }
    finally { c.release(); }
  });
}
