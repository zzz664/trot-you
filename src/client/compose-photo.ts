import {
  COMPOSE_IMAGE_HEADER as HEADER,
  COMPOSE_PHOTO,
} from '@/config/compose-capture';

export type ComposePhotoErrorCode =
  'unsupported' | 'tooLarge' | 'invalid' | 'unavailable' | 'aborted' | 'busy';
export class ComposePhotoError extends Error {
  constructor(readonly code: ComposePhotoErrorCode) {
    super(code);
    this.name = 'ComposePhotoError';
  }
}
let photoBusy = false;
function failure(code: ComposePhotoErrorCode): never {
  throw new ComposePhotoError(code);
}
const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) failure('aborted');
};
function bounded<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const rejectWith = (code: ComposePhotoErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ComposePhotoError(code));
    };
    const onAbort = () => rejectWith('aborted');
    const timer = setTimeout(
      () => rejectWith('unavailable'),
      COMPOSE_PHOTO.operationTimeoutMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    work.then(
      (value) => {
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      () => rejectWith('invalid'),
    );
  });
}
function fourCc(view: DataView, offset: number): string {
  if (view.byteLength < offset + HEADER.fourCcLength) return '';
  return String.fromCharCode(
    ...Array.from({ length: HEADER.fourCcLength }, (_, i) =>
      view.getUint8(offset + i),
    ),
  );
}
function unsigned24(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) +
    (view.getUint8(offset + 1) << HEADER.byteShift) +
    (view.getUint8(offset + HEADER.jpegSegmentLengthBytes) << HEADER.wordShift)
  );
}
function dimensions(bytes: ArrayBuffer, mime: string) {
  const view = new DataView(bytes);
  if (mime === 'image/png') {
    if (
      view.byteLength < HEADER.pngMinimumLength ||
      !HEADER.pngSignature.every((value, i) => view.getUint8(i) === value) ||
      fourCc(view, HEADER.webpChunkOffset) !== 'IHDR'
    )
      return failure('invalid');
    return {
      width: view.getUint32(HEADER.pngWidthOffset),
      height: view.getUint32(HEADER.pngHeightOffset),
    };
  }
  if (mime === 'image/jpeg') {
    if (
      view.byteLength < HEADER.jpegMinimumLength ||
      view.getUint8(0) !== HEADER.jpegPrefix ||
      view.getUint8(1) !== HEADER.jpegStart
    )
      return failure('invalid');
    let offset = HEADER.jpegMinimumLength;
    while (offset < view.byteLength) {
      if (view.getUint8(offset) !== HEADER.jpegPrefix)
        return failure('invalid');
      while (
        offset < view.byteLength &&
        view.getUint8(offset) === HEADER.jpegPrefix
      )
        offset += 1;
      if (offset >= view.byteLength) return failure('invalid');
      const marker = view.getUint8(offset);
      offset += 1;
      if (
        marker === HEADER.jpegScan ||
        marker === HEADER.jpegEnd ||
        offset + HEADER.jpegSegmentLengthBytes > view.byteLength
      )
        return failure('invalid');
      const length = view.getUint16(offset);
      if (
        length < HEADER.jpegSegmentLengthBytes ||
        offset + length > view.byteLength
      )
        return failure('invalid');
      if ((HEADER.jpegFrameMarkers as readonly number[]).includes(marker)) {
        if (length < HEADER.jpegFrameMinimumLength) return failure('invalid');
        return {
          width: view.getUint16(offset + HEADER.jpegFrameWidthOffset),
          height: view.getUint16(offset + HEADER.jpegFrameHeightOffset),
        };
      }
      offset += length;
    }
    return failure('invalid');
  }
  if (
    view.byteLength < HEADER.webpMinimumLength ||
    fourCc(view, HEADER.webpRiffOffset) !== 'RIFF' ||
    fourCc(view, HEADER.webpSignatureOffset) !== 'WEBP'
  )
    return failure('invalid');
  const chunk = fourCc(view, HEADER.webpChunkOffset);
  if (chunk === 'VP8X') {
    if (view.getUint8(HEADER.webpPayloadOffset) & HEADER.webpAnimationMask)
      return failure('unsupported');
    return {
      width: unsigned24(view, HEADER.webpExtendedWidthOffset) + 1,
      height: unsigned24(view, HEADER.webpExtendedHeightOffset) + 1,
    };
  }
  if (chunk === 'VP8 ') {
    if (
      !HEADER.vp8Signature.every(
        (value, i) => view.getUint8(HEADER.vp8SignatureOffset + i) === value,
      )
    )
      return failure('invalid');
    return {
      width:
        view.getUint16(HEADER.webpLossyWidthOffset, true) &
        HEADER.webpDimensionMask,
      height:
        view.getUint16(HEADER.webpLossyHeightOffset, true) &
        HEADER.webpDimensionMask,
    };
  }
  if (
    chunk === 'VP8L' &&
    view.getUint8(HEADER.webpPayloadOffset) === HEADER.webpLosslessSignature
  ) {
    const bits = view.getUint32(HEADER.webpLosslessBitsOffset, true);
    return {
      width: (bits & HEADER.webpDimensionMask) + 1,
      height:
        ((bits >>> HEADER.webpLosslessHeightShift) & HEADER.webpDimensionMask) +
        1,
    };
  }
  return failure('unsupported');
}
function validateDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    failure('invalid');
  if (
    width > COMPOSE_PHOTO.sourceMaxDimension ||
    height > COMPOSE_PHOTO.sourceMaxDimension ||
    width * height > COMPOSE_PHOTO.sourceMaxPixels
  )
    failure('tooLarge');
}

// This is a bounded browser convenience transform, not an authorization or
// content-validation boundary. Existing secure upload completion still validates
// the resulting bytes. Source metadata and the user's filename are not copied.
export async function resizeComposePhoto(
  file: File,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<File> {
  aborted(signal);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    failure('unsupported');
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    file.size > COMPOSE_PHOTO.sourceMaxBytes
  )
    failure('tooLarge');
  if (file.size <= 0) failure('invalid');
  if (typeof createImageBitmap !== 'function') failure('unavailable');
  if (photoBusy) failure('busy');
  photoBusy = true;
  let bitmap: ImageBitmap | undefined;
  let pendingDecode: Promise<ImageBitmap> | undefined;
  let decoding = false;
  let canvas: HTMLCanvasElement | undefined;
  try {
    const header = await bounded(
      file.slice(0, COMPOSE_PHOTO.headerMaxBytes).arrayBuffer(),
      signal,
    );
    const size = dimensions(header, file.type);
    validateDimensions(size.width, size.height);
    aborted(signal);
    // Header preflight limits the decoder's source allocation before decoding.
    // Preserve orientation in browser decode; scale after its actual dimensions
    // are checked so portrait EXIF transforms cannot be stretched.
    decoding = true;
    pendingDecode = createImageBitmap(file, { imageOrientation: 'from-image' });
    void pendingDecode.then(
      () => {
        decoding = false;
      },
      () => {
        decoding = false;
      },
    );
    bitmap = await bounded(pendingDecode, signal, (late) => late.close());
    validateDimensions(bitmap.width, bitmap.height);
    aborted(signal);
    const scale = Math.min(
      1,
      COMPOSE_PHOTO.outputMaxEdge / Math.max(bitmap.width, bitmap.height),
    );
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) failure('unavailable');
    context.fillStyle = COMPOSE_PHOTO.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    bitmap = undefined;
    const limit = Math.min(maxBytes, COMPOSE_PHOTO.outputMaxBytes);
    for (const quality of COMPOSE_PHOTO.qualitySteps) {
      aborted(signal);
      const blob = await bounded(
        new Promise<Blob | null>((resolve) =>
          canvas!.toBlob(resolve, COMPOSE_PHOTO.mime, quality),
        ),
        signal,
      );
      if (!blob || blob.type !== COMPOSE_PHOTO.mime || blob.size <= 0)
        failure('unavailable');
      if (blob.size <= limit) {
        aborted(signal);
        return new File([blob], COMPOSE_PHOTO.filename, {
          type: COMPOSE_PHOTO.mime,
          lastModified: 0,
        });
      }
    }
    return failure('tooLarge');
  } catch (error) {
    if (error instanceof ComposePhotoError) throw error;
    return failure('invalid');
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    // Native decode is not abortable. Keep its single-flight reservation until
    // it settles even if the caller has already timed out/canceled.
    if (decoding && pendingDecode)
      void pendingDecode.then(
        () => {
          photoBusy = false;
        },
        () => {
          photoBusy = false;
        },
      );
    else photoBusy = false;
  }
}
