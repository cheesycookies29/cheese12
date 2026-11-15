// What a request body may look like, checked by the dispatcher before any handler runs.
//
// 1. For every request (checkStructure): a JSON object, not too deeply nested or too large, and no
//    key that could reach an object's prototype (__proto__, constructor, prototype). The JSON reader
//    in server.js already drops those keys; this catches bodies that arrive any other way.
// 2. For routes that declare one (route(…, { body: { … } })): each field's type and size. Fields the
//    route does not declare are removed, so a handler only ever sees what it asked for (no extra
//    field such as "role" or "status" can slip through to a record).
//
// Built on plain JavaScript; no schema library.
import { HttpError } from './util.js';

const bad = (msg) => {
  throw new HttpError(400, msg);
};
export const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 12;
const MAX_NODES = 200000;
const MAX_KEY = 200;

// JSON.parse reviver: leaves out keys that could reach a prototype.
export const safeReviver = (key, value) => (PROTO_KEYS.has(key) ? undefined : value);

export function checkStructure(body) {
  if (body == null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) bad('The request body must be a JSON object.');
  let nodes = 0;
  const walk = (v, depth) => {
    if (v === null || typeof v !== 'object') return;
    if (depth > MAX_DEPTH) bad('The request is nested too deeply.');
    if (++nodes > MAX_NODES) bad('The request has too many parts.');
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const k of Object.keys(v)) {
      if (PROTO_KEYS.has(k)) bad(`The request has a field ATLAS does not accept (${k}).`);
      if (k.length > MAX_KEY) bad('The request has a field name that is too long.');
      walk(v[k], depth + 1);
    }
  };
  // Own "__proto__" keys are not listed by Object.keys on a literal, so look for them directly too.
  if (Object.hasOwn(body, '__proto__')) bad('The request has a field ATLAS does not accept (__proto__).');
  walk(body, 0);
  return body;
}

// ----- Field types -----
// Every field is optional (the handler says which it needs); null passes through as null.
export const t = {
  // A string of at most `max` characters (numbers are accepted and turned into strings).
  str: (max, { trim = false, pattern = null } = {}) => ({ kind: 'str', max, trim, pattern }),
  int: (min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => ({ kind: 'int', min, max }),
  num: (min = -Number.MAX_VALUE, max = Number.MAX_VALUE) => ({ kind: 'num', min, max }),
  bool: () => ({ kind: 'bool' }),
  oneOf: (...values) => ({ kind: 'oneOf', values }),
  arr: (item, max) => ({ kind: 'arr', item, max }),
  obj: (shape) => ({ kind: 'obj', shape }),
  // Anything (still under the structural limits); for opaque values such as an uploaded file.
  any: () => ({ kind: 'any' }),
};

function field(value, type, name) {
  if (value === undefined || value === null) return value;
  switch (type.kind) {
    case 'str': {
      if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
      if (typeof value !== 'string') bad(`${name} must be text.`);
      if (value.length > type.max) bad(`${name} is too long (${type.max} characters at most).`);
      if (type.trim) value = value.trim();
      if (type.pattern && value !== '' && !type.pattern.test(value)) bad(`${name} is not in the expected form.`);
      return value;
    }
    case 'int':
    case 'num': {
      if (value === '') return value; // an empty form field: the handler decides
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n) || (type.kind === 'int' && !Number.isInteger(n))) bad(`${name} must be a ${type.kind === 'int' ? 'whole ' : ''}number.`);
      if (n < type.min || n > type.max) bad(`${name} must be between ${type.min} and ${type.max}.`);
      return n;
    }
    case 'bool':
      if (value === true || value === false) return value;
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0' || value === '') return false;
      return bad(`${name} must be yes or no.`);
    case 'oneOf':
      if (!type.values.includes(value)) bad(`${name} is not one of the allowed choices.`);
      return value;
    case 'arr':
      if (!Array.isArray(value)) bad(`${name} must be a list.`);
      if (value.length > type.max) bad(`${name} has too many items (${type.max} at most).`);
      return value.map((x, i) => field(x, type.item, `${name} item ${i + 1}`));
    case 'obj':
      if (typeof value !== 'object' || Array.isArray(value)) bad(`${name} must be a group of fields.`);
      return shape(value, type.shape, `${name}.`);
    case 'any':
      return value;
    default:
      throw new Error(`Unknown field type ${type.kind}`);
  }
}

function shape(value, spec, prefix = '') {
  const out = {};
  for (const [k, type] of Object.entries(spec)) {
    if (Object.hasOwn(value, k)) out[k] = field(value[k], type, `${prefix}${k}`);
  }
  return out;
}

// The body a route declared, with undeclared fields removed.
export function checkBody(body, spec) {
  return shape(body || {}, spec);
}
