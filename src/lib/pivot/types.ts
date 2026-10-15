/** A raw value as it arrives from Beekeeper Studio (query results or a grid selection). */
export type CellValue = unknown;

export type ColumnType = "number" | "date" | "boolean" | "string";

export interface DataColumn {
  /** Unique name for the column inside the dataset. Used as the field id. */
  name: string;
  type: ColumnType;
  /** Database type, if Beekeeper reported one. */
  dbType?: string;
}

export interface Dataset {
  columns: DataColumn[];
  rows: CellValue[][];
}

export type AggregatorId =
  | "count"
  | "countDistinct"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "median"
  | "stdev"
  | "variance"
  | "first"
  | "last";

export type ShowAs = "value" | "pctGrandTotal" | "pctRowTotal" | "pctColTotal";

export interface ValueField {
  /** Stable id so the UI can key value chips. */
  id: string;
  /** Column to aggregate. `null` means "count rows". */
  field: string | null;
  agg: AggregatorId;
  showAs: ShowAs;
}

export type DateGrouping =
  | "none"
  | "year"
  | "quarter"
  | "month"
  | "week"
  | "day"
  | "hour"
  | "monthOfYear"
  | "dayOfWeek";

export type SortOrder = "asc" | "desc" | "valueAsc" | "valueDesc";

export interface FieldOptions {
  dateGroup?: DateGrouping;
  sort?: SortOrder;
  /** Labels (after date grouping) that are filtered out. */
  exclude?: string[];
}

export type Decimals = "auto" | 0 | 1 | 2 | 3 | 4;

export interface PivotConfig {
  rows: string[];
  cols: string[];
  values: ValueField[];
  /** Fields that are only used to filter. */
  filters: string[];
  fieldOptions: Record<string, FieldOptions>;
  /** Where multiple value fields are laid out. */
  valuesOn: "cols" | "rows";
  /** Total column on the right of each row. */
  rowTotals: boolean;
  /** Total row at the bottom of each column. */
  colTotals: boolean;
  subtotals: boolean;
  decimals: Decimals;
}

export type AggValue = number | string | null;
