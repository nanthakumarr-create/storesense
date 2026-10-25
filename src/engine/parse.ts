// Excel → typed records + data flags. STUB: replaced by the full parser.
// Contract: never throws on messy rows; flags them instead. Throws only when the file is not a workbook
// or has no recognisable Applications sheet (message is shown to the user as-is).
import type { ParseResult } from '../types';

export function parseWorkbook(_data: ArrayBuffer, fileName: string): ParseResult {
  return {
    applications: [],
    territories: [],
    stores: [],
    warnings: ['Parser not implemented yet'],
    source: { fileName, sheetNames: [], exampleRowDropped: false, blankRowsSkipped: 0, storesFromFile: false },
  };
}
