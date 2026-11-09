declare function deepmerge<T>(
  target: Partial<T>,
  source: Partial<T>,
  options?: deepmerge.Options,
): T;
declare function deepmerge<Target, Source>(
  target: Partial<Target>,
  source: Partial<Source>,
  options?: deepmerge.Options,
): Target & Source;

declare namespace deepmerge {
  interface Options {
    arrayMerge?(
      target: unknown[],
      source: unknown[],
      options?: ArrayMergeOptions,
    ): unknown[];
    clone?: boolean;
    customMerge?: (
      key: string,
      options?: Options,
    ) => ((target: unknown, source: unknown) => unknown) | undefined;
    isMergeableObject?(value: object): boolean;
  }

  interface ArrayMergeOptions {
    isMergeableObject(value: object): boolean;
    cloneUnlessOtherwiseSpecified(
      value: object,
      options?: Options,
    ): object;
  }

  function all(objects: object[], options?: Options): object;
  function all<T>(objects: Partial<T>[], options?: Options): T;
}

export = deepmerge;
