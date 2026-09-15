import { z } from 'zod';
import { metricSchema, type AnalyticsAdapter, type ProjectConfig, type Metric } from '../core/contracts.ts';

export const eventSchema = z.object({ visitor: z.string().min(1), session: z.string().min(1), event: z.string().min(1), group: z.string().nullable(), at: z.iso.datetime() }).strict();
export type Event = z.infer<typeof eventSchema>;
export type AnalyticsSource = { readonly type:string; readonly is_mock:boolean; readonly notice:string };
export const SYNTHETIC_MOCK_ANALYTICS_SOURCE:AnalyticsSource=Object.freeze({
  type:'synthetic_mock',is_mock:true,
  notice:'Built-in synthetic mock data is in use; these events and metrics are not from PostHog.',
});
export class EventAnalytics implements AnalyticsAdapter {
  constructor(private load: (config: ProjectConfig, start: string, end: string) => Promise<Event[]>,private source:AnalyticsSource={type:'event_adapter',is_mock:false,notice:'Events were supplied by the configured analytics adapter.'}) {}
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
    return { metrics, snapshot: { events: rows, parameters: p, period, sample: config.sample, source:this.source }, usage: { used: relevant.length, read: rows.length, exclusions: relevant.length === rows.length ? [] : [`${rows.length-relevant.length} rows outside the event definitions or analysis period`] }, failures };
  }
}
