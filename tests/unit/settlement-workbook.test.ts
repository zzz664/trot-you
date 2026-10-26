import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { SETTLEMENT_WORKBOOK as WORKBOOK } from '@/config/settlement-workbook';
import {
  createSettlementWorkbook,
  type SettlementWorkbookLabels,
  type SettlementWorkbookModel,
} from '@/server/adapters/settlement-workbook';

const labels: SettlementWorkbookLabels = {
  summarySheet: '요약',
  eventSheet: '결제 이벤트 상세',
  summaryHeaders: ['항목', '값'],
  eventHeaders: ['이벤트 ID', '유형', '금액 (KRW)', '발생 시각', '반영 구분'],
};
const charge = {
  id: '30000000-0000-4000-8000-000000000001',
  kind: 'charge' as const,
  amountKrw: '900719925474099312345678901234567890',
  occurredAt: '2026-09-01T00:00:00+09:00',
  origin: 'current' as const,
};
const model: SettlementWorkbookModel = {
  summary: [
    ['reportId', '10000000-0000-4000-8000-000000000001'],
    ['grossKrw', charge.amountKrw],
    ['vat.exact.numerator', '900719925474099312345678901234567890'],
    ['vat.exact.denominator', '11'],
    ['finalAmountKrw', '2456508887656634488212340003367003'],
  ],
  events: [
    charge,
    {
      ...charge,
      id: '30000000-0000-4000-8000-000000000002',
      kind: 'refund',
      amountKrw: '-12345',
      origin: 'adjustment',
    },
  ],
};

// Independent bit-at-a-time CRC reference, rather than the adapter's lookup table.
function crc(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++)
      checksum = checksum & 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1;
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
function unzip(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  const end = data.length - 22;
  expect(data.readUInt32LE(end)).toBe(0x06054b50);
  expect(data.readUInt16LE(end + 4)).toBe(0);
  expect(data.readUInt16LE(end + 6)).toBe(0);
  expect(data.readUInt16LE(end + 8)).toBe(6);
  expect(data.readUInt16LE(end + 10)).toBe(6);
  expect(data.readUInt16LE(end + 20)).toBe(0);
  const centralStart = data.readUInt32LE(end + 16);
  expect(centralStart + data.readUInt32LE(end + 12)).toBe(end);
  let localOffset = 0;
  let centralOffset = centralStart;
  const files = new Map<string, string>();
  while (localOffset < centralStart) {
    expect(data.readUInt32LE(localOffset)).toBe(0x04034b50);
    expect(data.readUInt16LE(localOffset + 4)).toBe(20);
    expect(data.readUInt16LE(localOffset + 6)).toBe(0x0800);
    expect(data.readUInt16LE(localOffset + 8)).toBe(0);
    const length = data.readUInt32LE(localOffset + 18);
    expect(data.readUInt32LE(localOffset + 22)).toBe(length);
    const nameLength = data.readUInt16LE(localOffset + 26);
    expect(data.readUInt16LE(localOffset + 28)).toBe(0);
    const name = data
      .subarray(localOffset + 30, localOffset + 30 + nameLength)
      .toString('utf8');
    const contentStart = localOffset + 30 + nameLength;
    const content = data.subarray(contentStart, contentStart + length);
    const checksum = crc(content);
    expect(data.readUInt32LE(localOffset + 14)).toBe(checksum);
    expect(data.readUInt32LE(centralOffset)).toBe(0x02014b50);
    expect(data.readUInt16LE(centralOffset + 4)).toBe(20);
    expect(data.readUInt16LE(centralOffset + 6)).toBe(20);
    expect(data.readUInt16LE(centralOffset + 8)).toBe(0x0800);
    expect(data.readUInt16LE(centralOffset + 10)).toBe(0);
    expect(data.readUInt32LE(centralOffset + 16)).toBe(checksum);
    expect(data.readUInt32LE(centralOffset + 20)).toBe(length);
    expect(data.readUInt32LE(centralOffset + 24)).toBe(length);
    expect(data.readUInt16LE(centralOffset + 28)).toBe(nameLength);
    expect(data.readUInt16LE(centralOffset + 30)).toBe(0);
    expect(data.readUInt16LE(centralOffset + 32)).toBe(0);
    expect(data.readUInt16LE(centralOffset + 34)).toBe(0);
    expect(data.readUInt32LE(centralOffset + 42)).toBe(localOffset);
    expect(
      data
        .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
        .toString('utf8'),
    ).toBe(name);
    expect(files.has(name)).toBe(false);
    files.set(name, content.toString('utf8'));
    localOffset = contentStart + length;
    centralOffset += 46 + nameLength;
  }
  expect(localOffset).toBe(centralStart);
  expect(centralOffset).toBe(end);
  return files;
}
function parse(value: string) {
  const xml = new DOMParser().parseFromString(value, 'application/xml');
  expect(xml.querySelector('parsererror')).toBeNull();
  return xml;
}
function rows(xml: Document) {
  return [...xml.getElementsByTagName('row')].map((row) =>
    [...row.getElementsByTagName('t')].map((cell) => cell.textContent),
  );
}

describe('settlement workbook transport', () => {
  it('creates a standards-shaped CRC-verified ZIP with exactly two Korean sheets', () => {
    const files = unzip(createSettlementWorkbook(model, labels));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    for (const value of files.values()) parse(value);
    const workbook = parse(files.get('xl/workbook.xml')!);
    expect(
      [...workbook.getElementsByTagName('sheet')].map((sheet) =>
        sheet.getAttribute('name'),
      ),
    ).toEqual(['요약', '결제 이벤트 상세']);
    const rootRelationships = parse(files.get('_rels/.rels')!);
    expect(
      rootRelationships
        .getElementsByTagName('Relationship')[0]
        ?.getAttribute('Target'),
    ).toBe('xl/workbook.xml');
    const sheetRelationships = parse(files.get('xl/_rels/workbook.xml.rels')!);
    expect(
      [...sheetRelationships.getElementsByTagName('Relationship')].map(
        (entry) => entry.getAttribute('Target'),
      ),
    ).toEqual(['worksheets/sheet1.xml', 'worksheets/sheet2.xml']);
    for (const value of files.values()) {
      expect(value).not.toContain('TargetMode=');
      expect(value).not.toMatch(
        /vba|macroEnabled|externalLink|hyperlink|<f[ >]/,
      );
    }
  });

  it('writes every cell as literal text without narrowing decimal, rational or large integer strings', () => {
    const files = unzip(createSettlementWorkbook(model, labels));
    const summary = parse(files.get('xl/worksheets/sheet1.xml')!);
    const events = parse(files.get('xl/worksheets/sheet2.xml')!);
    expect(rows(summary)).toEqual([labels.summaryHeaders, ...model.summary]);
    expect(rows(events)).toEqual([
      labels.eventHeaders,
      ...model.events.map((event) => [
        event.id,
        event.kind,
        event.amountKrw,
        event.occurredAt,
        event.origin,
      ]),
    ]);
    for (const document of [summary, events]) {
      for (const cell of document.getElementsByTagName('c')) {
        expect(cell.getAttribute('t')).toBe('inlineStr');
        expect(cell.getElementsByTagName('f')).toHaveLength(0);
        expect(cell.getElementsByTagName('v')).toHaveLength(0);
        expect(
          cell.getElementsByTagName('t')[0]?.getAttribute('xml:space'),
        ).toBe('preserve');
      }
    }
  });

  it('makes formula-like, XML markup, Unicode and leading whitespace values inert without trimming', () => {
    const values = [
      '=HYPERLINK("https://invalid.example","open")',
      '+1+2',
      '-1+2',
      '@SUM(A1)',
      '\t=1+1',
      '<f>1+1</f>&"\'',
      ' 가수 🎤 한글\n두 줄\r마지막 ',
    ];
    const input = {
      summary: values.map((value) => ['label', value] as const),
      events: [],
    };
    const files = unzip(createSettlementWorkbook(input, labels));
    const document = parse(files.get('xl/worksheets/sheet1.xml')!);
    expect(
      rows(document)
        .slice(1)
        .map((row) => row[1]),
    ).toEqual(values);
    expect(document.getElementsByTagName('f')).toHaveLength(0);
    expect(document.getElementsByTagName('hyperlink')).toHaveLength(0);
  });

  it('escapes Excel control-sequence markers so their literal text is not reinterpreted', () => {
    const files = unzip(
      createSettlementWorkbook(
        { summary: [['_x0041_', '_x000D_ _X0042_ _x005F_']], events: [] },
        labels,
      ),
    );
    expect(rows(parse(files.get('xl/worksheets/sheet1.xml')!))[1]).toEqual([
      '_x005F_x0041_',
      '_x005F_x000D_ _x005F_X0042_ _x005F_x005F_',
    ]);
  });

  it('retains the event headers for an empty frozen source set', () => {
    const files = unzip(
      createSettlementWorkbook({ summary: [], events: [] }, labels),
    );
    expect(rows(parse(files.get('xl/worksheets/sheet2.xml')!))).toEqual([
      labels.eventHeaders,
    ]);
    expect(rows(parse(files.get('xl/worksheets/sheet1.xml')!))).toEqual([
      labels.summaryHeaders,
    ]);
  });

  it('is deterministic and does not mutate the authorized input projection', () => {
    const input = structuredClone(model);
    const snapshot = structuredClone(input);
    expect(createSettlementWorkbook(input, labels)).toEqual(
      createSettlementWorkbook(input, labels),
    );
    expect(input).toEqual(snapshot);
  });
});

describe('settlement workbook fails closed', () => {
  it.each([
    '\0',
    '\u0001',
    '\u0008',
    '\u000B',
    '\u000C',
    '\u001F',
    '\uFFFE',
    '\uFFFF',
    '\uD800',
    '\uDC00',
  ])(
    'rejects non-XML character %j rather than silently changing a report',
    (value) => {
      expect(() =>
        createSettlementWorkbook(
          { summary: [['key', value]], events: [] },
          labels,
        ),
      ).toThrow(WORKBOOK.invalidInput);
    },
  );

  it.each([
    { ...charge, kind: 'initial' },
    { ...charge, kind: 'renewal' },
    { ...charge, kind: 'failed' },
    { ...charge, kind: 'refund' },
    { ...charge, amountKrw: '0' },
    { ...charge, amountKrw: '-1' },
    { ...charge, amountKrw: '1.2' },
    { ...charge, amountKrw: '1e10' },
    { ...charge, amountKrw: '01' },
    { ...charge, amountKrw: 100 },
    { ...charge, amountKrw: '1'.repeat(WORKBOOK.maxAmountCharacters + 1) },
    { ...charge, id: 'not-an-event-id' },
    { ...charge, occurredAt: 'not-a-timestamp' },
    { ...charge, origin: 'unknown' },
    { ...charge, fanId: 'private-fan' },
    { ...charge, providerPayload: 'private-evidence' },
  ])('rejects invalid or overprojected financial rows %#', (event) => {
    expect(() =>
      createSettlementWorkbook(
        { summary: [], events: [event] } as unknown as SettlementWorkbookModel,
        labels,
      ),
    ).toThrow(WORKBOOK.invalidInput);
  });

  it('rejects repeated event identities and unexpected model or label keys', () => {
    expect(() =>
      createSettlementWorkbook(
        { summary: [], events: [charge, charge] },
        labels,
      ),
    ).toThrow(WORKBOOK.invalidInput);
    expect(() =>
      createSettlementWorkbook(
        { ...model, provider: 'not permitted' } as SettlementWorkbookModel,
        labels,
      ),
    ).toThrow(WORKBOOK.invalidInput);
    expect(() =>
      createSettlementWorkbook(model, {
        ...labels,
        externalUrl: 'not permitted',
      } as SettlementWorkbookLabels),
    ).toThrow(WORKBOOK.invalidInput);
  });

  it.each([
    '',
    'a/b',
    'a\\b',
    'a?b',
    'a*b',
    '[a]',
    'a:b',
    "'quote",
    "quote'",
    'a'.repeat(32),
  ])('rejects invalid worksheet name %s', (summarySheet) => {
    expect(() =>
      createSettlementWorkbook(model, { ...labels, summarySheet }),
    ).toThrow(WORKBOOK.invalidInput);
  });

  it('rejects case-insensitive duplicate sheet names', () => {
    expect(() =>
      createSettlementWorkbook(model, {
        ...labels,
        summarySheet: 'Summary',
        eventSheet: 'SUMMARY',
      }),
    ).toThrow(WORKBOOK.invalidInput);
  });

  it('accepts the Excel cell character limit and rejects one character over', () => {
    expect(() =>
      createSettlementWorkbook(
        {
          summary: [['key', 'x'.repeat(WORKBOOK.maxCellCharacters)]],
          events: [],
        },
        labels,
      ),
    ).not.toThrow();
    expect(() =>
      createSettlementWorkbook(
        {
          summary: [['key', 'x'.repeat(WORKBOOK.maxCellCharacters + 1)]],
          events: [],
        },
        labels,
      ),
    ).toThrow(WORKBOOK.invalidInput);
  });

  it('rejects rows beyond the reviewed technical bounds', () => {
    expect(() =>
      createSettlementWorkbook(
        {
          summary: Array.from(
            { length: WORKBOOK.maxSummaryRows + 1 },
            () => ['key', 'value'] as const,
          ),
          events: [],
        },
        labels,
      ),
    ).toThrow(WORKBOOK.invalidInput);
    expect(() =>
      createSettlementWorkbook(
        {
          summary: [],
          events: Array.from({ length: WORKBOOK.maxEvents + 1 }, () => charge),
        },
        labels,
      ),
    ).toThrow(WORKBOOK.invalidInput);
  });

  it('counts escaped UTF-8 bytes and rejects an oversized archive instead of returning a truncated file', () => {
    expect(() =>
      createSettlementWorkbook(
        {
          summary: Array.from(
            { length: WORKBOOK.maxSummaryRows },
            () => ['key', '&'.repeat(WORKBOOK.maxCellCharacters)] as const,
          ),
          events: [],
        },
        labels,
      ),
    ).toThrow(WORKBOOK.sizeExceeded);
  });
});
