import { expect, test } from 'bun:test';
import {
  ICON_CATALOG,
  resolveIcon,
  searchIcons,
  withoutCatalogIcons,
  withReferencedIcons
} from '../src/core/icons';
import { emptyModel } from '../src/core/model';
import { htmlToText, textToHtml } from '../src/core/text';
import type { Model } from '../src/core/types';

test('catalog icon ids are unique across collections', () => {
  expect(new Set(ICON_CATALOG.map((icon) => icon.id)).size).toBe(ICON_CATALOG.length);
});

test('a custom icon that reuses a catalog id is kept and wins over the catalog', () => {
  const mine = { id: 'server', name: 'Mine', url: 'data:image/png;base64,AAAA' };
  const model: Model = { ...emptyModel('Custom'), icons: [mine], items: [{ id: 'a', name: 'A', icon: 'server' }] };

  expect(withoutCatalogIcons(model).icons).toEqual([mine]);
  expect(withReferencedIcons(model).icons).toEqual([mine]);
  expect(resolveIcon(model, 'server')).toEqual(mine);
});

test('stripping catalog icons undoes embedding them', () => {
  const model: Model = {
    ...emptyModel('Round trip'),
    items: [
      { id: 'a', name: 'A', icon: 'server' },
      { id: 'b', name: 'B', icon: '_aws_' }
    ]
  };

  const embedded = withReferencedIcons(model);

  expect(embedded.icons.map((icon) => icon.id)).toEqual(['server', '_aws_']);
  expect(withoutCatalogIcons(embedded)).toEqual(model);
});

test('search ranks a whole-word isometric match first and honours the collection filter', () => {
  const inAws = searchIcons('storage', { collection: 'aws' });

  expect(searchIcons('storage')[0].id).toBe('storage');
  expect(inAws.length).toBeGreaterThan(0);
  expect(inAws.every((icon) => icon.collection === 'aws')).toBe(true);
});

test('plain text survives the trip through the editor HTML, markup characters and blank lines included', () => {
  const text = 'Uses <script> & "quotes"\n\nSecond paragraph';

  const html = textToHtml(text);

  expect(html).not.toContain('<script>');
  expect(htmlToText(html)).toBe(text);
});
