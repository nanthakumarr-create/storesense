// Test helpers (node only): load the sample workbook and build the engine context from the bundled JSON.
import fs from 'node:fs';
import path from 'node:path';
import type { EngineContext, PinDemand, PinInfo, StoreCatchment } from '../types';
import kaPins from '../data/ka-pins.json';
import demand from '../data/blr-demand.json';
import catchment from '../data/blr-catchment.json';

export const ROOT = path.resolve(__dirname, '../..');
export const SAMPLE = path.join(ROOT, 'public/sample/StoreSense_Applicants_200.xlsx');

export function readArrayBuffer(file: string): ArrayBuffer {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export function buildCtx(): EngineContext {
  return {
    pins: kaPins as PinInfo[],
    demand: Object.fromEntries((demand as PinDemand[]).map((d) => [d.pin, d])),
    catchment: catchment as StoreCatchment[],
  };
}
