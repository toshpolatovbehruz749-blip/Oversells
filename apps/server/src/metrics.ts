import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics of this process (app or compile worker), served at
 * /metrics. Metrics are module-level singletons; gauges read their values at
 * scrape time from sources that the app/worker register (several apps can
 * live in one test process, so sources are added and removed).
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'oversells_' });

type GaugeSource = () => Promise<Array<{ labels?: Record<string, string>; value: number }>> | Array<{ labels?: Record<string, string>; value: number }>;
const gaugeSources = new Map<string, Set<GaugeSource>>();

function sourcedGauge(name: string, help: string, labelNames: string[] = []): Gauge {
  const sources = new Set<GaugeSource>();
  gaugeSources.set(name, sources);
  return new Gauge({
    name,
    help,
    labelNames,
    registers: [registry],
    async collect() {
      this.reset();
      for (const source of sources) {
        for (const { labels, value } of await source()) {
          if (labels) this.inc(labels, value);
          else this.inc(value);
        }
      }
    },
  });
}

export const metrics = {
  httpSeconds: new Histogram({
    name: 'oversells_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  }),
  compiles: new Counter({
    name: 'oversells_compile_jobs_total',
    help: 'Finished compile jobs by result',
    labelNames: ['status'],
    registers: [registry],
  }),
  compileSeconds: new Histogram({
    name: 'oversells_compile_duration_seconds',
    help: 'Compile job duration',
    labelNames: ['status'],
    buckets: [0.5, 1, 2, 4, 8, 15, 30, 60, 120],
    registers: [registry],
  }),
  aiRequests: new Counter({
    name: 'oversells_ai_requests_total',
    help: 'AI assistance requests by kind and outcome',
    labelNames: ['kind', 'outcome'],
    registers: [registry],
  }),
  compileQueue: sourcedGauge('oversells_compile_queue_jobs', 'Compile jobs waiting or running', ['status']),
  collabConnections: sourcedGauge('oversells_collab_connections', 'Open real-time editing connections'),
  collabDocuments: sourcedGauge('oversells_collab_documents', 'Documents loaded in memory'),
};

/** Registers a value source for a gauge; returns a function that removes it. */
export function addGaugeSource(gauge: Gauge, source: GaugeSource): () => void {
  const name = (gauge as unknown as { name: string }).name;
  const sources = gaugeSources.get(name);
  if (!sources) throw new Error(`Not a sourced gauge: ${name}`);
  sources.add(source);
  return () => sources.delete(source);
}
