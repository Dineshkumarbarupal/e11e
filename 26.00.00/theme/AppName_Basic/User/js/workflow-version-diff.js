function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return "[" + value.map(stableSerialize).join(",") + "]";
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    return "{" + keys.map(key => JSON.stringify(key) + ":" + stableSerialize(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function pathSegment(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? path + "." + key
    : path + "[" + JSON.stringify(key) + "]";
}

/**
 * Compare two JSON workflow definitions by path.
 * Object key order is ignored; array order is significant. A changed array is
 * returned as one path-level change, which keeps large node/edge edits readable.
 */
export function diffWorkflowDefinitions(before, after) {
  const changes = [];

  function walk(oldValue, newValue, path, oldExists, newExists) {
    if (!oldExists || !newExists) {
      changes.push({
        path,
        beforeExists: oldExists,
        afterExists: newExists,
        beforeValue: oldValue,
        afterValue: newValue
      });
      return;
    }

    if (isPlainRecord(oldValue) && isPlainRecord(newValue)) {
      const keys = [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].sort();
      for (const key of keys) {
        const hasOld = Object.prototype.hasOwnProperty.call(oldValue, key);
        const hasNew = Object.prototype.hasOwnProperty.call(newValue, key);
        walk(oldValue[key], newValue[key], pathSegment(path, key), hasOld, hasNew);
      }
      return;
    }

    if (stableSerialize(oldValue) !== stableSerialize(newValue)) {
      changes.push({
        path,
        beforeExists: oldExists,
        afterExists: newExists,
        beforeValue: oldValue,
        afterValue: newValue
      });
    }
  }

  walk(before, after, "$", before !== undefined, after !== undefined);
  return changes;
}
