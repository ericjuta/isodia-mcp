/**
 * A made-up online store, drawn as one busy view. It is the sample picture in the README.
 *
 * Usage, with an isodia server running:
 *
 *   PORT=4410 ISODIA_DB=/tmp/storefront.db bun src/server/index.ts &
 *   bun examples/storefront.ts --url http://127.0.0.1:4410 --out docs/sample --png-only
 *
 * The view lives in `storefront-spec.ts`; `document.ts` builds it through the MCP server and
 * writes the files.
 */
import { document } from './document';
import { STOREFRONT } from './storefront-spec';

await document({
  name: 'Storefront',
  description: 'A made-up online store: clients, edge, services, background work, data and third parties.',
  file: 'storefront',
  views: [STOREFRONT]
});
