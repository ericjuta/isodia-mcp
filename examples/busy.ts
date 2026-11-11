/**
 * Document the Busy repository (https://github.com/MatiSolina/busy) as Isoflow diagrams.
 *
 * Usage, with a isodia server running:
 *
 *   PORT=4410 ISODIA_DB=/tmp/busy-docs.db bun src/server/index.ts &
 *   bun examples/busy.ts --url http://127.0.0.1:4410 --out ../busy/docs/diagrams
 *
 * The views live here; `document.ts` builds them through the MCP server and writes the files.
 */
import { document, type Spec } from './document';

const VIEWS: Spec[] = [
  {
    view: 'Deployment',
    groups: [
      { id: 'clients', name: 'Clients', color: 'teal' },
      { id: 'hub', name: 'Hub', color: 'blue' },
      { id: 'platform', name: 'Vercel platform', color: 'purple' },
      { id: 'bots', name: 'Bots', color: 'green' }
    ],
    nodes: [
      { id: 'browser', name: 'Browser', icon: 'desktop', group: 'clients', description: 'Web UI, mobile layouts' },
      { id: 'desktop', name: 'Desktop (macOS)', icon: 'laptop', group: 'clients', description: 'Thin Electron shell' },
      { id: 'hub', name: 'Hub', icon: 'server', group: 'hub', description: 'Session, APIs, SSE projection' },
      { id: 'auth', name: 'Auth and OIDC', icon: 'lock', group: 'hub', description: 'Password account, Vercel OIDC, bot JWTs' },
      { id: 'mcpapps', name: 'MCP Apps', icon: 'firewall', group: 'hub', description: 'Isolated iframe sandbox origin' },
      { id: 'postgres', name: 'Postgres', icon: 'storage', group: 'platform', description: 'Authoritative application state' },
      { id: 'blob', name: 'Blob', icon: 'package-module', group: 'platform', description: 'Private files and library objects' },
      { id: 'workflow', name: 'Workflow', icon: 'function-module', group: 'platform', description: 'Durable deploy, routines, code tasks' },
      { id: 'queues', name: 'Queues', icon: 'queue', group: 'platform', description: 'Committed outbox delivery' },
      { id: 'schedules', name: 'Schedules', icon: 'cronjob', group: 'platform', description: 'Reconcilers that claim rows' },
      { id: 'gateway', name: 'AI Gateway', icon: 'router', group: 'platform', description: 'Model routing; keys stay server-side' },
      { id: 'botproject', name: 'Bot project', icon: 'cube', group: 'bots', description: 'Own Vercel project and domain' },
      { id: 'eve', name: 'Eve session', icon: 'sphere', group: 'bots', description: 'Durable turns, tools, memory' },
      { id: 'computer', name: 'Sandbox', icon: 'vm', group: 'bots', description: 'Linux desktop, browser, Office' },
      { id: 'drive', name: 'Drive', icon: 'diamond', group: 'bots', description: 'Workspace files outlive a run' }
    ],
    edges: [
      { from: 'browser', to: 'hub', label: 'session cookie' },
      { from: 'desktop', to: 'hub', label: 'BUSY_URL' },
      { from: 'hub', to: 'auth' },
      { from: 'hub', to: 'postgres' },
      { from: 'hub', to: 'blob' },
      { from: 'hub', to: 'workflow' },
      { from: 'hub', to: 'queues' },
      { from: 'schedules', to: 'workflow', label: 'claims rows' },
      { from: 'hub', to: 'mcpapps' },
      { from: 'hub', to: 'botproject', label: '5-min bot JWT' },
      { from: 'botproject', to: 'eve' },
      { from: 'eve', to: 'computer' },
      { from: 'computer', to: 'drive' },
      { from: 'eve', to: 'gateway' },
      { from: 'workflow', to: 'botproject', label: 'deploy' }
    ]
  },
  {
    view: 'Message path',
    groups: [
      { id: 'write', name: '1 Accept and persist', color: 'blue' },
      { id: 'run', name: '2 Bot turn', color: 'green' },
      { id: 'back', name: '3 Project back to the browser', color: 'teal' }
    ],
    nodes: [
      { id: 'post', name: 'POST /api/chat', icon: 'function-module', group: 'write', description: 'Proxy checks cookie and same origin' },
      { id: 'persist', name: 'Message + delivery', icon: 'storage', group: 'write', description: 'Postgres row is the delivery identity' },
      { id: 'session', name: 'Eve session', icon: 'sphere', group: 'run', description: 'Idempotent session per bot' },
      { id: 'turn', name: 'Turn and tools', icon: 'vm', group: 'run', description: 'Computer, MCP tools, skills' },
      { id: 'model', name: 'Model call', icon: 'router', group: 'run', description: 'AI Gateway or subscription proxy' },
      { id: 'stream', name: 'Stream v27 events', icon: 'queue', group: 'back', description: 'Authenticated callback to the Hub' },
      { id: 'items', name: 'Chat projection', icon: 'server', group: 'back', description: 'Browser never sees provider secrets' },
      { id: 'sse', name: 'SSE to browser', icon: 'desktop', group: 'back', description: 'Reconnect and replay the projection' }
    ],
    edges: [
      { from: 'post', to: 'persist' },
      { from: 'persist', to: 'session', label: 'session_not_ready retry' },
      { from: 'session', to: 'turn' },
      { from: 'turn', to: 'model' },
      { from: 'turn', to: 'stream' },
      { from: 'stream', to: 'items' },
      { from: 'items', to: 'sse' }
    ]
  },
  {
    view: 'Durable work',
    groups: [
      { id: 'request', name: 'Request', color: 'blue' },
      { id: 'async', name: 'Async execution', color: 'purple' },
      { id: 'durable', name: 'Durable progress', color: 'green' }
    ],
    nodes: [
      { id: 'route', name: 'Route handler', icon: 'function-module', group: 'request', description: 'Short authenticated request' },
      { id: 'tx', name: 'Transaction + outbox', icon: 'storage', group: 'request', description: 'State and intent commit together' },
      { id: 'queue', name: 'Vercel Queue', icon: 'queue', group: 'async', description: 'At-least-once delivery' },
      { id: 'consumer', name: 'Consumer route', icon: 'server', group: 'async', description: 'Authenticates the queue request' },
      { id: 'workflow', name: 'Workflow', icon: 'function-module', group: 'durable', description: 'Replayable steps and retries' },
      { id: 'provider', name: 'Provider step', icon: 'cloud', group: 'durable', description: 'Vercel API, model or bot call' },
      { id: 'sleep', name: 'Sleep or retry', icon: 'cronjob', group: 'durable', description: 'Survives a process restart' },
      { id: 'schedule', name: 'Schedule', icon: 'dns', group: 'async', description: 'Claims stale rows, starts work' }
    ],
    edges: [
      { from: 'route', to: 'tx' },
      { from: 'tx', to: 'queue' },
      { from: 'queue', to: 'consumer' },
      { from: 'consumer', to: 'workflow' },
      { from: 'workflow', to: 'provider' },
      { from: 'provider', to: 'sleep' },
      { from: 'sleep', to: 'provider', style: 'DOTTED' },
      { from: 'schedule', to: 'workflow', label: 'claims rows' }
    ]
  },
  {
    view: 'Trust boundaries',
    groups: [
      { id: 'untrusted', name: 'Untrusted', color: 'red' },
      { id: 'holder', name: 'Hub (holds credentials)', color: 'blue' },
      { id: 'subject', name: 'Bot (OIDC subject)', color: 'green' }
    ],
    nodes: [
      { id: 'browser', name: 'Browser or Desktop', icon: 'desktop', group: 'untrusted', description: 'Session cookie only' },
      { id: 'iframe', name: 'MCP App iframe', icon: 'firewall', group: 'untrusted', description: 'Separate origin, no cookies' },
      { id: 'hub', name: 'Hub routes', icon: 'server', group: 'holder', description: 'Holds VERCEL_TOKEN, Blob and signing key' },
      { id: 'db', name: 'Postgres', icon: 'storage', group: 'holder', description: 'Every access decision' },
      { id: 'bot', name: 'Bot endpoint', icon: 'cube', group: 'subject', description: 'Project ID and OIDC subject' },
      { id: 'sandbox', name: 'Sandbox', icon: 'vm', group: 'subject', description: 'Digest-pinned image; deny-all for consults' }
    ],
    edges: [
      { from: 'browser', to: 'hub', label: 'cookie + same origin' },
      { from: 'hub', to: 'db' },
      { from: 'iframe', to: 'hub', label: 'host recovers result', style: 'DOTTED' },
      { from: 'hub', to: 'bot', label: 'ES256, 5 min' },
      { from: 'bot', to: 'sandbox' }
    ]
  },
  {
    view: 'Repository map',
    groups: [
      { id: 'apps', name: 'Applications', color: 'blue' },
      { id: 'bot', name: 'Bot plane', color: 'green' },
      { id: 'shared', name: 'Shared', color: 'purple' }
    ],
    nodes: [
      { id: 'hub', name: 'apps/hub', icon: 'server', group: 'apps', description: 'UI, APIs, lib, workflows, drizzle' },
      { id: 'desktop', name: 'apps/desktop', icon: 'laptop', group: 'apps', description: 'Electron shell and updater' },
      { id: 'template', name: 'templates/bot', icon: 'cube', group: 'bot', description: 'Eve agent, tools, skills, sandbox' },
      { id: 'image', name: 'images/bot-base', icon: 'image', group: 'bot', description: 'Digest-pinned computer image' },
      { id: 'docs', name: 'docs/', icon: 'document', group: 'shared', description: 'Contracts and maintenance guides' },
      { id: 'setup', name: 'skills/busy-setup', icon: 'diamond', group: 'shared', description: 'Self-hosting procedure' },
      { id: 'ci', name: '.github/', icon: 'cronjob', group: 'shared', description: 'Affected CI planning' }
    ],
    edges: [
      { from: 'hub', to: 'template', label: 'bundles' },
      { from: 'hub', to: 'image', label: 'deploys' },
      { from: 'docs', to: 'hub', style: 'DOTTED' },
      { from: 'setup', to: 'docs', style: 'DOTTED' },
      { from: 'ci', to: 'hub', style: 'DOTTED' }
    ]
  }
];

await document({
  name: 'Busy — architecture',
  description: 'How Busy is deployed, how a message flows, and where its trust boundaries sit.',
  file: 'busy-architecture',
  views: VIEWS
});
