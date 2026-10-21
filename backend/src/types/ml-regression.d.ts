/**
 * Minimal type declarations for ml-regression (the package ships no types).
 * Only the APIs actually used by the AI engine are declared.
 */
declare module 'ml-regression' {
  export class SimpleLinearRegression {
    constructor(x: number[], y: number[]);
    readonly slope: number;
    readonly intercept: number;
    predict(x: number | number[]): number | number[];
    toString(precision?: number): string;
    score(x: number[], y: number[]): { r2: number; absoluteError: number; absolutePercentageError: number; meanAbsoluteError: number; rootMeanSquaredError: number };
  }

  export class PolynomialRegression {
    constructor(x: number[], y: number[], degree: number);
    predict(x: number | number[]): number | number[];
  }

  export class MultivariateLinearRegression {
    constructor(x: number[][], y: number[][], options?: { intercept?: boolean });
    predict(x: number[][]): number[][];
  }

  export class PowerRegression {
    constructor(x: number[], y: number[]);
    predict(x: number | number[]): number | number[];
  }

  export class ExponentialRegression {
    constructor(x: number[], y: number[]);
    predict(x: number | number[]): number | number[];
  }
}
