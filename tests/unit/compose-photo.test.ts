import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { resizeComposePhoto } from '@/client/compose-photo';
import { COMPOSE_PHOTO } from '@/config/compose-capture';

function png(width = 100, height = 80): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
}
function jpeg(width = 100, height = 80): ArrayBuffer {
  return Uint8Array.from([
    255,
    216,
    255,
    192,
    0,
    7,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
  ]).buffer;
}
function webp(
  kind: 'VP8 ' | 'VP8L' | 'VP8X',
  width = 100,
  height = 80,
): ArrayBuffer {
  const bytes = new Uint8Array(30);
  const text = (value: string, offset: number) =>
    bytes.set(
      Array.from(value, (char) => char.charCodeAt(0)),
      offset,
    );
  text('RIFF', 0);
  text('WEBP', 8);
  text(kind, 12);
  const view = new DataView(bytes.buffer);
  if (kind === 'VP8 ') {
    bytes.set([157, 1, 42], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  } else if (kind === 'VP8L') {
    bytes[20] = 47;
    view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  } else {
    const set = (offset: number, value: number) => {
      bytes[offset] = value & 255;
      bytes[offset + 1] = (value >> 8) & 255;
      bytes[offset + 2] = (value >> 16) & 255;
    };
    set(24, width - 1);
    set(27, height - 1);
  }
  return bytes.buffer;
}
function input(bytes = png(), type = 'image/png', size?: number): File {
  const file = new File([bytes], 'Private-person-location.png', {
    type,
    lastModified: 123456,
  });
  vi.spyOn(file, 'slice').mockImplementation(
    () => ({ arrayBuffer: async () => bytes }) as Blob,
  );
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}
let bitmap: ImageBitmap;
let close: ReturnType<typeof vi.fn>;
let decode: ReturnType<typeof vi.fn>;
let context: {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};
let canvas: HTMLCanvasElement;
let output: Blob | null;
let encode: MockInstance<HTMLCanvasElement['toBlob']>;
beforeEach(() => {
  close = vi.fn();
  bitmap = { width: 100, height: 80, close } as unknown as ImageBitmap;
  decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal('createImageBitmap', decode);
  context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  output = new Blob(['sanitized'], { type: 'image/jpeg' });
  encode = vi
    .spyOn(canvas, 'toBlob')
    .mockImplementation((callback) => callback(output));
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name, options) =>
    name === 'canvas' ? canvas : original(name, options),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
// Small synthetic header/canvas contract fixtures only. Native decoder fidelity
// and server media validation remain separate from this browser convenience API.
describe('resource-bounded browser photo preparation', () => {
  it.each([
    ['image/png', () => png()],
    ['image/jpeg', () => jpeg()],
    ['image/webp', () => webp('VP8 ')],
    ['image/webp', () => webp('VP8L')],
    ['image/webp', () => webp('VP8X')],
  ] as const)(
    'accepts ordinary %s headers before browser decode',
    async (type, bytes) => {
      const file = input(bytes(), type);
      const result = await resizeComposePhoto(file, 1000);
      expect(decode).toHaveBeenCalledExactlyOnceWith(file, {
        imageOrientation: 'from-image',
      });
      expect(result).toMatchObject({
        type: 'image/jpeg',
        size: 9,
        name: 'photo.jpg',
        lastModified: 0,
      });
      expect(context.fillStyle).toBe(COMPOSE_PHOTO.background);
      expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(
        bitmap,
        0,
        0,
        100,
        80,
      );
      expect(close).toHaveBeenCalledOnce();
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    },
  );
  it('bounds source reads and scales the oriented bitmap without enlarging', async () => {
    const file = input(png(4000, 3000));
    bitmap = { width: 3000, height: 4000, close } as unknown as ImageBitmap;
    decode.mockResolvedValue(bitmap);
    await resizeComposePhoto(file, 1000);
    expect(file.slice).toHaveBeenCalledExactlyOnceWith(
      0,
      COMPOSE_PHOTO.headerMaxBytes,
    );
    expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(
      bitmap,
      0,
      0,
      1440,
      1920,
    );
  });
  it('retries a finite number of quality levels until output fits policy', async () => {
    encode.mockImplementationOnce((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array(2000)], { type: 'image/jpeg' })),
    );
    await resizeComposePhoto(input(), 1000);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(encode.mock.calls.map(([, , quality]) => quality)).toEqual(
      COMPOSE_PHOTO.qualitySteps.slice(0, 2),
    );
  });
  it('fails after bounded quality attempts rather than uploading oversize output', async () => {
    output = new Blob([new Uint8Array(2000)], { type: 'image/jpeg' });
    await expect(resizeComposePhoto(input(), 1)).rejects.toMatchObject({
      code: 'tooLarge',
    });
    expect(encode).toHaveBeenCalledTimes(COMPOSE_PHOTO.qualitySteps.length);
    expect(canvas.width).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 1.5])(
    'rejects invalid policy byte capacity %j before decode',
    async (limit) => {
      await expect(resizeComposePhoto(input(), limit)).rejects.toMatchObject({
        code: 'tooLarge',
      });
      expect(decode).not.toHaveBeenCalled();
    },
  );
  it.each(['image/gif', 'image/svg+xml', '', 'image/avif'])(
    'rejects unsupported input MIME %s',
    async (mime) => {
      await expect(
        resizeComposePhoto(input(png(), mime), 1000),
      ).rejects.toMatchObject({ code: 'unsupported' });
      expect(decode).not.toHaveBeenCalled();
    },
  );
  it('bounds source bytes before reading or decoding', async () => {
    const file = input(png(), 'image/png', COMPOSE_PHOTO.sourceMaxBytes + 1);
    await expect(resizeComposePhoto(file, 1000)).rejects.toMatchObject({
      code: 'tooLarge',
    });
    expect(file.slice).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });
  it.each([
    [0, 10, 'invalid'],
    [10, 0, 'invalid'],
    [20000, 1, 'tooLarge'],
    [1, 20000, 'tooLarge'],
    [8000, 8000, 'tooLarge'],
  ])('bounds %j by %j source dimensions', async (width, height, code) => {
    await expect(
      resizeComposePhoto(input(png(Number(width), Number(height))), 1000),
    ).rejects.toMatchObject({ code });
    expect(decode).not.toHaveBeenCalled();
  });
  it('rechecks actual decoded dimensions and closes mismatched oversized output', async () => {
    decode.mockResolvedValue({ width: 20000, height: 1, close });
    await expect(resizeComposePhoto(input(), 1000)).rejects.toMatchObject({
      code: 'tooLarge',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(encode).not.toHaveBeenCalled();
  });
  it.each([
    new ArrayBuffer(0),
    new ArrayBuffer(24),
    new Uint8Array([255, 216]).buffer,
  ])(
    'rejects absent/invalid header dimensions before decode',
    async (bytes) => {
      await expect(
        resizeComposePhoto(input(bytes), 1000),
      ).rejects.toMatchObject({ code: 'invalid' });
      expect(decode).not.toHaveBeenCalled();
    },
  );
  it('rejects extended animated WebP rather than silently choosing a frame', async () => {
    const bytes = webp('VP8X');
    new Uint8Array(bytes)[20] = 2;
    await expect(
      resizeComposePhoto(input(bytes, 'image/webp'), 1000),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(decode).not.toHaveBeenCalled();
  });
  it('rejects an unsupported browser rather than uploading the original with metadata', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(resizeComposePhoto(input(), 1000)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
  it.each([
    null,
    new Blob([], { type: 'image/jpeg' }),
    new Blob(['png fallback'], { type: 'image/png' }),
  ])('rejects failed or unsupported canvas encoding', async (value) => {
    output = value;
    await expect(resizeComposePhoto(input(), 1000)).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('does no network, storage or object-URL work', async () => {
    const fetcher = vi.fn();
    const url = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('URL', { createObjectURL: url });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    await resizeComposePhoto(input(), 1000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(url).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
});
describe('photo interruption and single-flight cleanup', () => {
  it('rejects an already-canceled request before reads/decodes', async () => {
    const signal = AbortSignal.abort();
    const file = input();
    await expect(resizeComposePhoto(file, 1000, signal)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(file.slice).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });
  it('retains decode reservation after cancellation until a late native bitmap is closed', async () => {
    let resolve!: (value: ImageBitmap) => void;
    decode.mockReturnValueOnce(
      new Promise<ImageBitmap>((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const first = resizeComposePhoto(input(), 1000, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await expect(resizeComposePhoto(input(), 1000)).rejects.toMatchObject({
      code: 'busy',
    });
    resolve(bitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    await resizeComposePhoto(input(), 1000);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('times out an unresolved decode and closes its late result before permitting another', async () => {
    vi.useFakeTimers();
    let resolve!: (value: ImageBitmap) => void;
    decode.mockReturnValueOnce(
      new Promise<ImageBitmap>((done) => {
        resolve = done;
      }),
    );
    const first = resizeComposePhoto(input(), 1000);
    const rejection = expect(first).rejects.toMatchObject({
      code: 'unavailable',
    });
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(COMPOSE_PHOTO.operationTimeoutMs);
    await rejection;
    await expect(resizeComposePhoto(input(), 1000)).rejects.toMatchObject({
      code: 'busy',
    });
    resolve(bitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    await resizeComposePhoto(input(), 1000);
  });
  it('normalizes a native decode rejection without exposing metadata', async () => {
    decode.mockRejectedValueOnce(new Error('GPS private filename'));
    await expect(resizeComposePhoto(input(), 1000)).rejects.toMatchObject({
      message: 'invalid',
      code: 'invalid',
    });
    await resizeComposePhoto(input(), 1000);
  });
  it('cancels pending encoding and releases the already-decoded canvas', async () => {
    let encodeDone!: BlobCallback;
    encode.mockImplementationOnce((callback: BlobCallback) => {
      encodeDone = callback;
    });
    const controller = new AbortController();
    const work = resizeComposePhoto(input(), 1000, controller.signal);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    controller.abort();
    await expect(work).rejects.toMatchObject({ code: 'aborted' });
    expect(canvas.width).toBe(0);
    expect(close).toHaveBeenCalledOnce();
    encodeDone(output);
  });
});
