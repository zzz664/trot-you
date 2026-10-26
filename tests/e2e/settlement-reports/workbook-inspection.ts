import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

// Independent bounded ZIP reader for the generated workbook, not its production
// writer. It accepts only simple stored/deflated XLSX entries and verifies the
// central directory offsets/count, lengths and duplicate/traversal boundaries.
export function inspectWorkbook(bytes: Buffer): Map<string, string> {
  assert.ok(bytes.length > 22 && bytes.length <= 32 * 1024 * 1024);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 4), 0);
  assert.equal(bytes.readUInt16LE(end + 6), 0);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count);
  assert.ok(count >= 6 && count <= 16);
  let offset = bytes.readUInt32LE(end + 16);
  const directoryStart = offset;
  const entries = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const flags = bytes.readUInt16LE(offset + 8);
    assert.equal(flags & 1, 0);
    const method = bytes.readUInt16LE(offset + 10);
    assert.ok(method === 0 || method === 8);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    assert.ok(size <= 32 * 1024 * 1024);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    assert.ok(
      !name.includes('..') && !name.startsWith('/') && !entries.has(name),
    );
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const localNameLength = bytes.readUInt16LE(local + 26);
    const localExtraLength = bytes.readUInt16LE(local + 28);
    assert.equal(
      bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8'),
      name,
    );
    const start = local + 30 + localNameLength + localExtraLength;
    assert.ok(start + compressed <= directoryStart);
    const input = bytes.subarray(start, start + compressed);
    const body =
      method === 0
        ? input
        : inflateRawSync(input, { maxOutputLength: 32 * 1024 * 1024 });
    assert.equal(body.length, size);
    entries.set(name, body.toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, end);
  assert.equal(offset - directoryStart, bytes.readUInt32LE(end + 12));
  return entries;
}
