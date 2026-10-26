import 'server-only';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  SETTLEMENT_WORKBOOK as WORKBOOK,
  SETTLEMENT_WORKBOOK_ZIP as ZIP,
} from '@/config/settlement-workbook';

export type SettlementWorkbookModel = {
  summary: readonly (readonly [string, string])[];
  events: readonly {
    id: string;
    kind: 'charge' | 'refund';
    amountKrw: string;
    occurredAt: string;
    origin: 'current' | 'adjustment';
  }[];
};
export type SettlementWorkbookLabels = {
  summarySheet: string;
  eventSheet: string;
  summaryHeaders: readonly [string, string];
  eventHeaders: readonly [string, string, string, string, string];
};

// Reject data that XML 1.0 cannot represent, including lone UTF-16 surrogates.
// Rejecting rather than stripping preserves an honest, unmodified report.
function validXmlText(value: string) {
  for (const character of value) {
    if (
      !/^[\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]$/u.test(
        character,
      )
    )
      return false;
  }
  return true;
}
const cell = z.string().max(WORKBOOK.maxCellCharacters).refine(validXmlText);
const sheetName = cell
  .min(1)
  .max(WORKBOOK.maxSheetNameCharacters)
  .refine((value) => !/[\\/?*\[\]:]/.test(value) && !/^'|'$/.test(value));
const labelsSchema = z
  .strictObject({
    summarySheet: sheetName,
    eventSheet: sheetName,
    summaryHeaders: z.tuple([cell, cell]),
    eventHeaders: z.tuple([cell, cell, cell, cell, cell]),
  })
  .refine(
    (value) =>
      value.summarySheet.toLowerCase() !== value.eventSheet.toLowerCase(),
  );
const eventSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(['charge', 'refund']),
    amountKrw: z
      .string()
      .max(WORKBOOK.maxAmountCharacters)
      .regex(/^-?[1-9]\d*$/),
    occurredAt: z.iso.datetime({ offset: true }),
    origin: z.enum(['current', 'adjustment']),
  })
  .refine(
    (value) => (value.kind === 'refund') === value.amountKrw.startsWith('-'),
  );
const modelSchema = z
  .strictObject({
    summary: z.array(z.tuple([cell, cell])).max(WORKBOOK.maxSummaryRows),
    events: z.array(eventSchema).max(WORKBOOK.maxEvents),
  })
  .refine(
    (value) =>
      new Set(value.events.map((event) => event.id.toLowerCase())).size ===
      value.events.length,
  );

// Excel interprets _xHHHH_ even inside text cells: protect literal sequences
// before XML escaping. The explicitly typed inline string is never a formula.
function xml(value: string) {
  return value
    .replace(/_x[\da-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;');
}

function worksheet(
  rows: readonly (readonly string[])[],
  widths: readonly number[],
) {
  const lastColumn = WORKBOOK.columns[widths.length - 1];
  const parts = [
    WORKBOOK.xmlDeclaration,
    `<worksheet xmlns="${WORKBOOK.spreadsheetNamespace}">`,
    `<dimension ref="A1:${lastColumn}${rows.length}"/>`,
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    '<cols>',
    ...widths.map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    ),
    '</cols><sheetData>',
  ];
  let bytes = Buffer.byteLength(parts.join(''));
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1;
    const text = `<row r="${rowNumber}">${row.map((value, column) => `<c r="${WORKBOOK.columns[column]}${rowNumber}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`;
    bytes += Buffer.byteLength(text);
    if (bytes > WORKBOOK.maxWorkbookBytes)
      throw new Error(WORKBOOK.sizeExceeded);
    parts.push(text);
  }
  parts.push('</sheetData></worksheet>');
  return Buffer.from(parts.join(''), 'utf8');
}

const crcTable = Array.from({ length: ZIP.crcTableEntries }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < ZIP.byteBits; bit++)
    value = value & 1 ? ZIP.crcPolynomial ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let value: number = ZIP.crcMask;
  for (const byte of bytes)
    value =
      crcTable[(value ^ byte) & ZIP.lowByteMask]! ^ (value >>> ZIP.byteBits);
  return (value ^ ZIP.crcMask) >>> 0;
}

type BinaryField = readonly [number, 'word' | 'dword'];
function binary(fields: readonly BinaryField[]) {
  const bytes = Buffer.alloc(
    fields.reduce(
      (size, [, kind]) =>
        size + (kind === 'word' ? ZIP.wordBytes : ZIP.dwordBytes),
      0,
    ),
  );
  let offset = 0;
  for (const [value, kind] of fields) {
    if (kind === 'word') {
      bytes.writeUInt16LE(value, offset);
      offset += ZIP.wordBytes;
    } else {
      bytes.writeUInt32LE(value, offset);
      offset += ZIP.dwordBytes;
    }
  }
  return bytes;
}

// Stored ZIP only: no ZIP64, compression bomb, data descriptor, executable,
// directory entry, dynamic path, external relationship or arbitrary file input.
function archive(files: readonly (readonly [string, Buffer])[]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const [path, content] of files) {
    const name = Buffer.from(path, 'utf8');
    const checksum = crc32(content);
    const common: BinaryField[] = [
      [ZIP.version, 'word'],
      [ZIP.utf8Flag, 'word'],
      [ZIP.storedMethod, 'word'],
      [ZIP.dosTime, 'word'],
      [ZIP.dosDate, 'word'],
      [checksum, 'dword'],
      [content.length, 'dword'],
      [content.length, 'dword'],
      [name.length, 'word'],
      [0, 'word'],
    ];
    const header = binary([[ZIP.localSignature, 'dword'], ...common]);
    const directory = binary([
      [ZIP.centralSignature, 'dword'],
      [ZIP.version, 'word'],
      ...common,
      [0, 'word'],
      [0, 'word'],
      [0, 'word'],
      [0, 'dword'],
      [offset, 'dword'],
    ]);
    local.push(header, name, content);
    central.push(directory, name);
    offset += header.length + name.length + content.length;
    centralSize += directory.length + name.length;
    if (offset + centralSize > WORKBOOK.maxWorkbookBytes)
      throw new Error(WORKBOOK.sizeExceeded);
  }
  const end = binary([
    [ZIP.endSignature, 'dword'],
    [0, 'word'],
    [0, 'word'],
    [files.length, 'word'],
    [files.length, 'word'],
    [centralSize, 'dword'],
    [offset, 'dword'],
    [0, 'word'],
  ]);
  if (offset + centralSize + end.length > WORKBOOK.maxWorkbookBytes)
    throw new Error(WORKBOOK.sizeExceeded);
  return Buffer.concat([...local, ...central, end]);
}

/** Serialize an already-authorized frozen projection. This performs no I/O. */
export function createSettlementWorkbook(
  model: SettlementWorkbookModel,
  labels: SettlementWorkbookLabels,
): Uint8Array {
  const checkedModel = modelSchema.safeParse(model);
  const checkedLabels = labelsSchema.safeParse(labels);
  if (!checkedModel.success || !checkedLabels.success)
    throw new Error(WORKBOOK.invalidInput);
  const data = checkedModel.data;
  const copy = checkedLabels.data;
  const declaration = WORKBOOK.xmlDeclaration;
  const office = WORKBOOK.officeRelationshipsNamespace;
  const contentTypes = `${declaration}<Types xmlns="${WORKBOOK.contentTypesNamespace}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rootRelationships = `${declaration}<Relationships xmlns="${WORKBOOK.packageRelationshipsNamespace}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `${declaration}<workbook xmlns="${WORKBOOK.spreadsheetNamespace}" xmlns:r="${office}"><sheets><sheet name="${xml(copy.summarySheet)}" sheetId="1" r:id="rId1"/><sheet name="${xml(copy.eventSheet)}" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const sheetRelationships = `${declaration}<Relationships xmlns="${WORKBOOK.packageRelationshipsNamespace}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${office}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
  return archive([
    ['[Content_Types].xml', Buffer.from(contentTypes)],
    ['_rels/.rels', Buffer.from(rootRelationships)],
    ['xl/workbook.xml', Buffer.from(workbook)],
    ['xl/_rels/workbook.xml.rels', Buffer.from(sheetRelationships)],
    [
      'xl/worksheets/sheet1.xml',
      worksheet([copy.summaryHeaders, ...data.summary], WORKBOOK.summaryWidths),
    ],
    [
      'xl/worksheets/sheet2.xml',
      worksheet(
        [
          copy.eventHeaders,
          ...data.events.map((event) => [
            event.id,
            event.kind,
            event.amountKrw,
            event.occurredAt,
            event.origin,
          ]),
        ],
        WORKBOOK.eventWidths,
      ),
    ],
  ]);
}
