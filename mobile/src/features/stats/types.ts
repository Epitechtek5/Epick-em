export type StatType = 'flat' | 'percent' | 'select' | 'mvp';
export type StatScope = 'participant' | 'match';
export interface StatOption {
  key: string;
  label: string;
}

export interface Stat {
  id: string;
  name: string;
  key: string;
  type: StatType;
  scope?: StatScope;
  options?: StatOption[];
}

export type StatValues = Omit<Stat, 'id' | 'options'>;
export type StatChanges = Partial<StatValues>;
export type StatFieldErrors = Partial<Record<keyof StatValues, string>>;
export type StatFormat = 'json' | 'csv';

export interface StatImportReport {
  created: number;
  updated: number;
}
