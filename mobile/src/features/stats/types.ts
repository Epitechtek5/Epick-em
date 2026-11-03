export type StatType = 'flat' | 'percent';

export interface Stat {
  id: string;
  name: string;
  key: string;
  type: StatType;
}

export type StatValues = Omit<Stat, 'id'>;
export type StatChanges = Partial<StatValues>;
export type StatFieldErrors = Partial<Record<keyof StatValues, string>>;
export type StatFormat = 'json' | 'csv';

export interface StatImportReport {
  created: number;
  updated: number;
}
