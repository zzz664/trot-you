// Technical XLSX limits only. These are not accounting or payout policy.
export const SETTLEMENT_WORKBOOK = {
  maxEvents: 50_000,
  maxSummaryRows: 512,
  maxCellCharacters: 32_767,
  maxAmountCharacters: 100,
  maxSheetNameCharacters: 31,
  maxWorkbookBytes: 32 * 1024 * 1024,
  invalidInput: 'SETTLEMENT_WORKBOOK_INVALID_INPUT',
  sizeExceeded: 'SETTLEMENT_WORKBOOK_SIZE_EXCEEDED',
  columns: ['A', 'B', 'C', 'D', 'E'],
  summaryWidths: [32, 70],
  eventWidths: [44, 16, 30, 34, 18],
  xmlDeclaration: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  spreadsheetNamespace:
    'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  officeRelationshipsNamespace:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  packageRelationshipsNamespace:
    'http://schemas.openxmlformats.org/package/2006/relationships',
  contentTypesNamespace:
    'http://schemas.openxmlformats.org/package/2006/content-types',
} as const;

export const SETTLEMENT_WORKBOOK_ZIP = {
  localSignature: 0x04034b50,
  centralSignature: 0x02014b50,
  endSignature: 0x06054b50,
  version: 20,
  utf8Flag: 0x0800,
  storedMethod: 0,
  dosTime: 0,
  // 1980-01-01: stable output, with no private/user creation metadata.
  dosDate: 33,
  wordBytes: 2,
  dwordBytes: 4,
  byteBits: 8,
  crcTableEntries: 256,
  crcPolynomial: 0xedb88320,
  crcMask: 0xffffffff,
  lowByteMask: 0xff,
} as const;
