const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

export function isImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name);
}

/** DataTransfer(paste/drop)에서 첫 번째 이미지 파일 추출 */
export function extractImageFromDataTransfer(
  data: { items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>; files?: ArrayLike<File> } | null | undefined,
): File | null {
  if (!data) return null;
  if (data.items) {
    for (let i = 0; i < data.items.length; i += 1) {
      const item = data.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  if (data.files) {
    for (let i = 0; i < data.files.length; i += 1) {
      const file = data.files[i];
      if (isImageFile(file)) return file;
    }
  }
  return null;
}

/** Async Clipboard API(navigator.clipboard.read)에서 이미지 파일 읽기. 없으면 null */
export async function readImageFromClipboard(
  clipboard: Pick<Clipboard, 'read'> | undefined = typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
): Promise<File | null> {
  if (!clipboard || typeof clipboard.read !== 'function') {
    throw new Error('이 브라우저에서는 버튼 붙여넣기를 지원하지 않아요. Ctrl+V로 붙여넣어 주세요.');
  }
  let items: ClipboardItems;
  try {
    items = await clipboard.read();
  } catch (err) {
    if (err instanceof Error && err.name === 'NotAllowedError') {
      throw new Error('클립보드 접근 권한이 필요해요. Ctrl+V로 바로 붙여넣을 수 있어요.');
    }
    throw new Error('클립보드에서 이미지를 읽지 못했어요. Ctrl+V로 붙여넣어 주세요.');
  }
  for (const item of items) {
    const preferred =
      item.types.find((t) => t === 'image/png' || t === 'image/jpeg') ??
      item.types.find((t) => t.startsWith('image/'));
    if (!preferred) continue;
    const blob = await item.getType(preferred);
    const ext = EXT_BY_MIME[preferred] ?? 'png';
    return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: preferred });
  }
  return null;
}
