// Based on deepmerge 4.3.1 with the upstream fix from commit
// d0256cde79edba0c8e10a888ac439124318b14ca.
const defaultIsMergeableObject = require('is-mergeable-object');

function emptyTarget(value) {
  return Array.isArray(value) ? [] : {};
}

function cloneUnlessOtherwiseSpecified(value, options) {
  return options.clone !== false && options.isMergeableObject(value)
    ? deepmerge(emptyTarget(value), value, options)
    : value;
}

function defaultArrayMerge(target, source, options) {
  return target
    .concat(source)
    .map((element) => cloneUnlessOtherwiseSpecified(element, options));
}

function getMergeFunction(key, options) {
  if (!options.customMerge) return deepmerge;

  const customMerge = options.customMerge(key);
  return typeof customMerge === 'function' ? customMerge : deepmerge;
}

function getEnumerableOwnPropertySymbols(target) {
  return Object.getOwnPropertySymbols
    ? Object.getOwnPropertySymbols(target).filter((symbol) =>
        Object.propertyIsEnumerable.call(target, symbol),
      )
    : [];
}

function getKeys(target) {
  return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target));
}

function propertyIsOnObject(object, property) {
  try {
    return property in object;
  } catch {
    return false;
  }
}

function propertyIsForbidden(key) {
  return key === '__proto__';
}

function propertyIsUnsafe(target, key) {
  return (
    propertyIsOnObject(target, key) &&
    !(
      Object.hasOwnProperty.call(target, key) &&
      Object.propertyIsEnumerable.call(target, key)
    )
  );
}

function mergeObject(target, source, options) {
  const destination = {};

  if (options.isMergeableObject(target)) {
    getKeys(target).forEach((key) => {
      if (propertyIsForbidden(key)) return;
      destination[key] = cloneUnlessOtherwiseSpecified(target[key], options);
    });
  }

  getKeys(source).forEach((key) => {
    if (propertyIsForbidden(key) || propertyIsUnsafe(target, key)) return;

    if (
      propertyIsOnObject(target, key) &&
      options.isMergeableObject(source[key])
    ) {
      destination[key] = getMergeFunction(key, options)(
        target[key],
        source[key],
        options,
      );
    } else {
      destination[key] = cloneUnlessOtherwiseSpecified(source[key], options);
    }
  });

  return destination;
}

function deepmerge(target, source, options = {}) {
  options.arrayMerge ||= defaultArrayMerge;
  options.isMergeableObject ||= defaultIsMergeableObject;
  options.cloneUnlessOtherwiseSpecified = cloneUnlessOtherwiseSpecified;

  const sourceIsArray = Array.isArray(source);
  const targetIsArray = Array.isArray(target);

  if (sourceIsArray !== targetIsArray) {
    return cloneUnlessOtherwiseSpecified(source, options);
  }
  if (sourceIsArray) return options.arrayMerge(target, source, options);
  return mergeObject(target, source, options);
}

deepmerge.all = function deepmergeAll(values, options) {
  if (!Array.isArray(values)) {
    throw new Error('first argument should be an array');
  }

  return values.reduce(
    (previous, next) => deepmerge(previous, next, options),
    {},
  );
};

module.exports = deepmerge;
