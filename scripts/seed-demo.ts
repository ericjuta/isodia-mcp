/**
 * Seeds the demo projects the browser check drives.
 *
 *   bun scripts/seed-demo.ts
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4400';

const post = async (path: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as unknown;
};

const spec = {
  groups: [
    { id: 'edge', name: 'Edge', color: 'blue' },
    { id: 'app', name: 'Application', color: 'green' },
    { id: 'data', name: 'Data', color: 'orange' }
  ],
  nodes: [
    { id: 'customers', name: 'Customers', icon: 'user', group: 'edge' },
    { id: 'cdn', name: 'CDN', icon: 'cloud', group: 'edge' },
    { id: 'waf', name: 'WAF', icon: 'gcp-security', group: 'edge' },
    { id: 'gateway', name: 'API gateway', icon: 'aws-api-gateway', group: 'app' },
    { id: 'storefront', name: 'Storefront', icon: 'azure-browser', group: 'app' },
    { id: 'orders', name: 'Orders', icon: 'aws-lambda', group: 'app' },
    { id: 'payments', name: 'Payments', icon: 'paymentcard', group: 'app' },
    { id: 'inventory', name: 'Inventory', icon: 'aws-database', group: 'data' },
    { id: 'warehouse', name: 'Warehouse', icon: 'storage', group: 'data' }
  ],
  edges: [
    { from: 'customers', to: 'cdn', label: 'HTTPS' },
    { from: 'cdn', to: 'waf', label: 'inspected' },
    { from: 'waf', to: 'gateway', label: 'allowed' },
    { from: 'gateway', to: 'storefront', label: 'REST' },
    { from: 'gateway', to: 'orders', label: 'gRPC' },
    { from: 'orders', to: 'payments', label: 'authorize' },
    { from: 'orders', to: 'inventory', label: 'reserve' },
    { from: 'inventory', to: 'warehouse', label: 'replenish', style: 'DASHED' as const }
  ]
};

const projects = [
  { id: 'acme-retail-platform', name: 'Acme retail platform' },
  { id: 'payments-platform', name: 'Payments platform' }
];

const existing = (await (await fetch(`${API}/api/projects`)).json()) as { id: string }[];

for (const project of projects) {
  if (existing.some((candidate) => candidate.id === project.id)) {
    await fetch(`${API}/api/projects/${project.id}`, { method: 'DELETE' });
  }
  await post('/api/projects', { id: project.id, name: project.name });
  const built = (await post(`/api/projects/${project.id}/build`, spec)) as { revision: number };
  console.log(`${project.id}: revision ${built.revision}`);
}

console.log(
  'projects:',
  ((await (await fetch(`${API}/api/projects`)).json()) as { id: string; revision: number }[]).map(
    (project) => `${project.id}@r${project.revision}`
  )
);
