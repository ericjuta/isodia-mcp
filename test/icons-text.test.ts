import { expect, test } from 'bun:test';
import {
  ICON_CATALOG,
  resolveIcon,
  searchIcons,
  withoutCatalogIcons,
  withReferencedIcons
} from '../src/core/icons';
import { emptyModel } from '../src/core/model';
import { ICON_DEFINITIONS } from '../src/core/iconset/icons';
import { Pen } from '../src/core/iconset/pen';
import { htmlToText, textToHtml } from '../src/core/text';
import type { Model } from '../src/core/types';

test('bundled icon ids are unique', () => {
  expect(new Set(ICON_CATALOG.map((icon) => icon.id)).size).toBe(ICON_CATALOG.length);
});

test('a custom icon that reuses a catalog id is kept and wins over the catalog', () => {
  const mine = { id: 'server', name: 'Mine', url: 'data:image/png;base64,AAAA' };
  const model: Model = { ...emptyModel('Custom'), icons: [mine], items: [{ id: 'a', name: 'A', icon: 'server' }] };

  expect(withoutCatalogIcons(model).icons).toEqual([mine]);
  expect(withReferencedIcons(model).icons).toEqual([mine]);
  expect(resolveIcon(model, 'server')).toEqual(mine);
});

test('stripping bundled icons undoes embedding them, and an embedded copy of an older drawing is dropped too', () => {
  const model: Model = {
    ...emptyModel('Round trip'),
    items: [
      { id: 'a', name: 'A', icon: 'server' },
      { id: 'b', name: 'B', icon: 'database' }
    ]
  };

  const embedded = withReferencedIcons(model);
  // What a file exported by the original Isoflow editor carries for the same noun.
  const older = { ...model, icons: [{ id: 'server', name: 'Server', url: 'data:image/svg+xml;base64,PHN2Zy8+', collection: 'isoflow', isIsometric: true }] };

  expect(embedded.icons.map((icon) => icon.id)).toEqual(['server', 'database']);
  expect(withoutCatalogIcons(embedded)).toEqual(model);
  expect(withoutCatalogIcons(older).icons).toEqual([]);
});

test('search puts a whole id word first, and answers to the names people use for a thing', () => {
  expect(searchIcons('storage')[0].id).toBe('storage');
  expect(searchIcons('postgres')[0].id).toBe('database');
  expect(searchIcons('s3')[0].id).toBe('bucket');
  expect(searchIcons('kafka')[0].id).toBe('queue');
  expect(searchIcons('lambda')[0].id).toBe('function-module');
  // An id word outranks a keyword: "cloud" is its own icon, though cdn and function answer to it.
  expect(searchIcons('cloud')[0].id).toBe('cloud');
  expect(searchIcons('zzzz')).toEqual([]);
});

test('every bundled icon is an SVG the renderer can size, the same bytes each time it is drawn', () => {
  for (const icon of ICON_CATALOG) {
    const svg = atob(icon.url.slice('data:image/svg+xml;base64,'.length));
    const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
    expect(root).toMatch(/\sviewBox="[-\d. ]+"/);
    expect(Number(/\swidth="([\d.]+)"/.exec(root)?.[1])).toBeGreaterThan(0);
    expect(Number(/\sheight="([\d.]+)"/.exec(root)?.[1])).toBeGreaterThan(0);
    expect(svg).not.toMatch(/NaN|Infinity/);
  }
  const redrawn = ICON_DEFINITIONS.map((definition) => {
    const pen = new Pen();
    definition.draw(pen);
    return `data:image/svg+xml;base64,${btoa(pen.svg())}`;
  });
  expect(redrawn).toEqual(ICON_CATALOG.map((icon) => icon.url));
});

test('plain text survives the trip through the editor HTML, markup characters and blank lines included', () => {
  const text = 'Uses <script> & "quotes"\n\nSecond paragraph';

  const html = textToHtml(text);

  expect(html).not.toContain('<script>');
  expect(htmlToText(html)).toBe(text);
});
