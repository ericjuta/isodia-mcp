import type { Spec } from './document';

/** A made-up online store. The README's sample picture and its recorded demo both draw this. */
export const STOREFRONT: Spec = {
  view: 'Storefront',
  groups: [
    { id: 'clients', name: 'Clients', color: 'teal' },
    { id: 'edge', name: 'Edge', color: 'blue' },
    { id: 'services', name: 'Services', color: 'green' },
    { id: 'async', name: 'Background work', color: 'purple' },
    { id: 'data', name: 'Data', color: 'yellow' },
    { id: 'outside', name: 'Third parties', color: 'red' }
  ],
  nodes: [
    { id: 'web', name: 'Web shop', icon: 'browser', group: 'clients', description: 'Server-rendered storefront' },
    { id: 'app', name: 'Mobile app', icon: 'mobiledevice', group: 'clients', description: 'iOS and Android' },
    { id: 'assistant', name: 'Shopping agent', icon: 'agent', group: 'clients', description: 'Orders on a customer’s behalf' },
    { id: 'cdn', name: 'CDN', icon: 'cdn', group: 'edge', description: 'Pages, images, cached catalogue' },
    { id: 'waf', name: 'Firewall', icon: 'firewall', group: 'edge', description: 'Rate limits and bot rules' },
    { id: 'gateway', name: 'API gateway', icon: 'gateway', group: 'edge', description: 'Auth, routing, quotas' },
    { id: 'catalogue', name: 'Catalogue', icon: 'service', group: 'services', description: 'Products, prices, stock' },
    { id: 'cart', name: 'Cart', icon: 'service', group: 'services', description: 'Baskets and promotions' },
    { id: 'orders', name: 'Orders', icon: 'service', group: 'services', description: 'Checkout and order state' },
    { id: 'identity', name: 'Identity', icon: 'key', group: 'services', description: 'Sessions and API tokens' },
    { id: 'events', name: 'Event stream', icon: 'stream', group: 'async', description: 'Order and stock events' },
    { id: 'fulfil', name: 'Fulfilment worker', icon: 'worker', group: 'async', description: 'Picks, packs, books a courier' },
    { id: 'notify', name: 'Notifier', icon: 'bell', group: 'async', description: 'Email and push' },
    { id: 'nightly', name: 'Nightly jobs', icon: 'cronjob', group: 'async', description: 'Reconcile payments and stock' },
    { id: 'db', name: 'Postgres', icon: 'database', group: 'data', description: 'Orders, customers, stock' },
    { id: 'cache', name: 'Cache', icon: 'cache', group: 'data', description: 'Sessions and hot products' },
    { id: 'index', name: 'Search index', icon: 'search', group: 'data', description: 'Catalogue search' },
    { id: 'psp', name: 'Payment provider', icon: 'paymentcard', group: 'outside', description: 'Cards and wallets' },
    { id: 'courier', name: 'Courier', icon: 'truck', group: 'outside', description: 'Labels and tracking' },
    { id: 'mail', name: 'Mail provider', icon: 'mail', group: 'outside', description: 'Transactional email' }
  ],
  edges: [
    { from: 'web', to: 'cdn' },
    { from: 'app', to: 'waf' },
    { from: 'assistant', to: 'waf', label: 'scoped token' },
    { from: 'cdn', to: 'waf' },
    { from: 'waf', to: 'gateway' },
    { from: 'gateway', to: 'identity', label: 'verify' },
    { from: 'gateway', to: 'catalogue' },
    { from: 'gateway', to: 'cart' },
    { from: 'gateway', to: 'orders' },
    { from: 'catalogue', to: 'index' },
    { from: 'catalogue', to: 'cache' },
    { from: 'cart', to: 'cache' },
    { from: 'orders', to: 'db' },
    { from: 'orders', to: 'psp', label: 'charge' },
    { from: 'orders', to: 'events', label: 'order placed' },
    { from: 'events', to: 'fulfil' },
    { from: 'events', to: 'notify' },
    { from: 'fulfil', to: 'courier', label: 'book' },
    { from: 'notify', to: 'mail' },
    { from: 'nightly', to: 'db', label: 'reconcile' }
  ]
};
