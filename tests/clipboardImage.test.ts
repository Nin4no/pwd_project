import assert from 'node:assert/strict';
import test from 'node:test';
import { extractImageFromDataTransfer, isImageFile, readImageFromClipboard } from '../src/features/studio/ai/clipboardImage.ts';

test('isImageFile detects image MIME types and common image extensions', () => {
  assert.equal(isImageFile({ type: 'image/png', name: '' }), true);
  assert.equal(isImageFile({ type: '', name: 'chair.WEBP' }), true);
  assert.equal(isImageFile({ type: 'text/plain', name: 'notes.txt' }), false);
});

test('extractImageFromDataTransfer picks clipboard image from items or files fallback', () => {
  const pngFile = new File(['abc'], 'shot.png', { type: 'image/png' });
  const fromItems = extractImageFromDataTransfer({
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => pngFile },
    ],
    files: [],
  });
  assert.equal(fromItems, pngFile);

  const jpgByExt = new File(['xyz'], 'desk.jpg', { type: '' });
  const fromFiles = extractImageFromDataTransfer({
    items: [],
    files: [jpgByExt],
  });
  assert.equal(fromFiles, jpgByExt);

  const textOnly = extractImageFromDataTransfer({
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    files: [],
  });
  assert.equal(textOnly, null);
});

test('readImageFromClipboard reads preferred image blob into File and handles empty/unsupported clipboard', async () => {
  const fakePng = new Blob(['pngdata'], { type: 'image/png' });
  const file = await readImageFromClipboard({
    read: async () => [
      {
        types: ['text/html', 'image/png'],
        getType: async (t: string) => {
          assert.equal(t, 'image/png');
          return fakePng;
        },
      } as unknown as ClipboardItem,
    ],
  });
  assert.ok(file instanceof File);
  assert.equal(file.type, 'image/png');
  assert.match(file.name, /\.png$/);

  const empty = await readImageFromClipboard({
    read: async () => [{ types: ['text/plain'], getType: async () => new Blob() } as unknown as ClipboardItem],
  });
  assert.equal(empty, null);

  await assert.rejects(() => readImageFromClipboard(undefined), /Ctrl\+V/);
});
