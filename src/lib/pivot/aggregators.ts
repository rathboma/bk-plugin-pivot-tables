import type { AggValue, AggregatorId, CellValue } from "./types";
import { compareLabels, toLabel, toNumber } from "./values";

export interface Aggregator {
  push(v: CellValue): void;
  value(): AggValue;
}

export interface AggregatorInfo {
  id: AggregatorId;
  label: string;
  /** Short label used in value captions, e.g. "Sum of amount". */
  caption: string;
  /** Only makes sense for numeric columns. */
  numeric: boolean;
  /** Result is always a number (so it can be shown as a percentage). */
  numericResult: boolean;
}

export const AGGREGATORS: AggregatorInfo[] = [
  { id: "count", label: "Count", caption: "Count", numeric: false, numericResult: true },
  { id: "countDistinct", label: "Count distinct", caption: "Distinct", numeric: false, numericResult: true },
  { id: "sum", label: "Sum", caption: "Sum", numeric: true, numericResult: true },
  { id: "avg", label: "Average", caption: "Avg", numeric: true, numericResult: true },
  { id: "min", label: "Minimum", caption: "Min", numeric: false, numericResult: false },
  { id: "max", label: "Maximum", caption: "Max", numeric: false, numericResult: false },
  { id: "median", label: "Median", caption: "Median", numeric: true, numericResult: true },
  { id: "stdev", label: "Std deviation", caption: "StdDev", numeric: true, numericResult: true },
  { id: "variance", label: "Variance", caption: "Variance", numeric: true, numericResult: true },
  { id: "first", label: "First", caption: "First", numeric: false, numericResult: false },
  { id: "last", label: "Last", caption: "Last", numeric: false, numericResult: false },
];

export const AGGREGATOR_MAP: Record<AggregatorId, AggregatorInfo> = Object.fromEntries(
  AGGREGATORS.map((a) => [a.id, a])
) as Record<AggregatorId, AggregatorInfo>;

const isNull = (v: CellValue) => v === null || v === undefined;

class CountAgg implements Aggregator {
  n = 0;
  push(v: CellValue) {
    if (!isNull(v)) this.n++;
  }
  value() {
    return this.n;
  }
}

class CountDistinctAgg implements Aggregator {
  seen = new Set<string>();
  push(v: CellValue) {
    if (!isNull(v)) this.seen.add(toLabel(v));
  }
  value() {
    return this.seen.size;
  }
}

class SumAgg implements Aggregator {
  sum = 0;
  n = 0;
  push(v: CellValue) {
    const x = toNumber(v);
    if (!isNaN(x)) {
      this.sum += x;
      this.n++;
    }
  }
  value() {
    return this.n ? this.sum : null;
  }
}

class AvgAgg extends SumAgg {
  value() {
    return this.n ? this.sum / this.n : null;
  }
}

/** Min/max work on numbers when possible, otherwise on labels (dates, text). */
class ExtremeAgg implements Aggregator {
  num: number | null = null;
  text: string | null = null;
  constructor(private dir: 1 | -1) {}
  push(v: CellValue) {
    if (isNull(v)) return;
    const x = toNumber(v);
    if (!isNaN(x)) {
      if (this.num === null || (x - this.num) * this.dir > 0) this.num = x;
    } else {
      const s = toLabel(v);
      if (this.text === null || compareLabels(s, this.text) * this.dir > 0) this.text = s;
    }
  }
  value() {
    return this.num !== null ? this.num : this.text;
  }
}

class MedianAgg implements Aggregator {
  xs: number[] = [];
  push(v: CellValue) {
    const x = toNumber(v);
    if (!isNaN(x)) this.xs.push(x);
  }
  value() {
    const n = this.xs.length;
    if (!n) return null;
    const s = [...this.xs].sort((a, b) => a - b);
    const mid = n >> 1;
    return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
}

/** Welford's online algorithm; sample variance (n - 1). */
class VarianceAgg implements Aggregator {
  n = 0;
  mean = 0;
  m2 = 0;
  constructor(private sqrt: boolean) {}
  push(v: CellValue) {
    const x = toNumber(v);
    if (isNaN(x)) return;
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }
  value() {
    if (this.n < 2) return null;
    const variance = this.m2 / (this.n - 1);
    return this.sqrt ? Math.sqrt(variance) : variance;
  }
}

class FirstAgg implements Aggregator {
  v: string | null = null;
  push(v: CellValue) {
    if (this.v === null && !isNull(v)) this.v = toLabel(v);
  }
  value() {
    return this.v;
  }
}

class LastAgg implements Aggregator {
  v: string | null = null;
  push(v: CellValue) {
    if (!isNull(v)) this.v = toLabel(v);
  }
  value() {
    return this.v;
  }
}

export function createAggregator(id: AggregatorId): Aggregator {
  switch (id) {
    case "count":
      return new CountAgg();
    case "countDistinct":
      return new CountDistinctAgg();
    case "sum":
      return new SumAgg();
    case "avg":
      return new AvgAgg();
    case "min":
      return new ExtremeAgg(-1);
    case "max":
      return new ExtremeAgg(1);
    case "median":
      return new MedianAgg();
    case "stdev":
      return new VarianceAgg(true);
    case "variance":
      return new VarianceAgg(false);
    case "first":
      return new FirstAgg();
    case "last":
      return new LastAgg();
  }
}
