// Sheet 3 of the judges' template. Fixed: used whenever the uploaded file has no "Existing stores" sheet.
import type { ExistingStore } from '../types';

export const EXISTING_STORES: ExistingStore[] = [
  { id: 'ST-01', city: 'Bengaluru', pin: '560001', opened: 2019 },
  { id: 'ST-02', city: 'Bengaluru', pin: '560034', opened: 2020 },
  { id: 'ST-03', city: 'Bengaluru', pin: '560038', opened: 2021 },
  { id: 'ST-04', city: 'Bengaluru', pin: '560066', opened: 2022 },
  { id: 'ST-05', city: 'Bengaluru', pin: '560076', opened: 2023 },
  { id: 'ST-06', city: 'Mysuru', pin: '570009', opened: 2021 },
  { id: 'ST-07', city: 'Mysuru', pin: '570017', opened: 2024 },
  { id: 'ST-08', city: 'Mangaluru', pin: '575001', opened: 2022 },
  { id: 'ST-09', city: 'Hubballi-Dharwad', pin: '580020', opened: 2023 },
  { id: 'ST-10', city: 'Belagavi', pin: '590001', opened: 2024 },
];
