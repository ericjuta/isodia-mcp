import publications from 'virtual:isodia/walkthroughs';
import type { Walkthrough } from '../core/walkthrough';
import type { WalkthroughReader } from '../server/walkthroughs';

const parsed = new Map<string, Walkthrough>();

/**
 * Publications bundled into the Worker when it was built. The build validates each reviewed file
 * with the same rules the Bun server applies on every read, so here a publication is parsed once
 * per isolate and never re-validated. They are not static assets: the only way to them is the
 * reader routes, which add the frame policy.
 */
export function bundledWalkthroughs(assets: Fetcher): WalkthroughReader {
  return {
    async load(id) {
      if (!Object.hasOwn(publications, id)) return null;
      let story = parsed.get(id);
      if (story === undefined) {
        story = JSON.parse(publications[id]) as Walkthrough;
        parsed.set(id, story);
      }
      return story;
    },
    async shell(request) {
      // The root path, not /index.html, which asset routing redirects to it.
      const response = await assets.fetch(new URL('/', request.url));
      return response.ok ? response.body : null;
    }
  };
}
