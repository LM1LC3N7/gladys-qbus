// -----------------------------------------------------------------------------
// The Qbus MQTT protocol, ported from qbusmqttapi 1.5.1 (MIT, Qbus: const.py,
// discovery.py, factory.py, state.py), the library of Home Assistant's Qbus
// integration. Pure: topics, parsers and the messages sent.
//
// Topics (prefix cloudapp/QBUSMQTTGW):
//   getConfig                    ask the gateway for its configuration (empty payload)
//   config                       the configuration: controllers and their outputs
//   state                        the gateway itself: { id, online, reason }
//   getState                     ask for states: a JSON array of ids
//   <controller>/state           a controller: { id, properties: { connected, connectable } }
//   <controller>/setState        activate a controller
//   <controller>/<output>/state     an output: { id, type, action?, properties }
//   <controller>/<output>/setState  a command to an output
//
// Everything received is untrusted: read bounded, ids checked before they go
// into a topic (no MQTT wildcard, no slash), only own keys of plain objects
// read (never an inherited or `__proto__` key), every value type-checked.
// -----------------------------------------------------------------------------

import { LIMITS, TOPIC_PREFIX } from './constants.js';

export const TOPICS = {
  getConfig: `${TOPIC_PREFIX}/getConfig`,
  config: `${TOPIC_PREFIX}/config`,
  gateway: `${TOPIC_PREFIX}/state`,
  getState: `${TOPIC_PREFIX}/getState`,
  controllerState: (controllerId) => `${TOPIC_PREFIX}/${controllerId}/state`,
  controllerCommand: (controllerId) => `${TOPIC_PREFIX}/${controllerId}/setState`,
  outputState: (controllerId, outputId) => `${TOPIC_PREFIX}/${controllerId}/${outputId}/state`,
  outputCommand: (controllerId, outputId) => `${TOPIC_PREFIX}/${controllerId}/${outputId}/setState`,
};

/** What the integration subscribes to. */
export const SUBSCRIPTIONS = [
  TOPICS.config,
  TOPICS.gateway,
  `${TOPIC_PREFIX}/+/state`,
  `${TOPIC_PREFIX}/+/+/state`,
];

/** An id that may go into a topic: letters, digits, "_" and "-" only. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isId = (value) => typeof value === 'string' && ID.test(value);

export const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** An own key of a plain object, else undefined. */
export const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

const text = (value, max = LIMITS.nameLength) =>
  typeof value === 'string' ? value.trim().slice(0, max).trim() : '';
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The Qbus "refId" ("000001/10", "000001/105/3") -> "10", "105-3" (Home Assistant's format_ref_id). */
export function formatRefId(refId) {
  if (typeof refId !== 'string' || refId.length > 64) {
    return undefined;
  }
  const match = /^\d+\/(\d+(?:\/\d+)?)$/.exec(refId);
  return match ? match[1].replace('/', '-') : undefined;
}

/** A parsed JSON payload, bounded; undefined when it is not JSON. */
export function parseJson(payload, maxBytes) {
  if (payload === undefined || payload === null || payload.length === 0) {
    return { error: 'empty' };
  }
  if (payload.length > maxBytes) {
    return { error: 'too large' };
  }
  try {
    return { value: JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : payload) };
  } catch {
    return { error: 'not JSON' };
  }
}

/** The limits of a writable number property: { min, max, step } (each may be undefined). */
function limitsOf(spec) {
  return {
    min: finite(own(spec, 'min')),
    max: finite(own(spec, 'max')),
    step: finite(own(spec, 'step')),
  };
}

function parseOutput(raw, controller) {
  const id = own(raw, 'id');
  const type = own(raw, 'type');
  if (!isId(id) || typeof type !== 'string') {
    return undefined;
  }
  const ref = formatRefId(own(raw, 'refId'));
  if (ref === undefined) {
    return undefined;
  }
  const properties = isObject(own(raw, 'properties')) ? own(raw, 'properties') : {};
  const actions = isObject(own(raw, 'actions')) ? own(raw, 'actions') : {};
  const variant = own(raw, 'variant');
  const has = (key) => Object.hasOwn(properties, key);
  return {
    id,
    ref,
    type: type.slice(0, 32),
    name: text(own(raw, 'name')) || text(own(raw, 'originalName')) || id,
    location: text(own(raw, 'location')),
    variant: typeof variant === 'string' ? variant.slice(0, 32).toUpperCase() : undefined,
    controller,
    has: Object.fromEntries(
      [
        'value',
        'state',
        'shutterPosition',
        'slatPosition',
        'setTemp',
        'currTemp',
        'currRegime',
        'co2',
        'on',
        'brightness',
        'hue',
        'saturation',
        'temperature',
        'light',
        'wind',
        'raining',
      ].map((k) => [k, has(k)]),
    ),
    actions: {
      stop: Object.hasOwn(actions, 'shutterStop'),
      active: Object.hasOwn(actions, 'active'),
    },
    limits: {
      value: limitsOf(own(properties, 'value')),
      setTemp: limitsOf(own(properties, 'setTemp')),
      currentValue: limitsOf(own(properties, 'currentValue')),
    },
    unit:
      typeof own(own(properties, 'currentValue'), 'unit') === 'string'
        ? own(own(properties, 'currentValue'), 'unit').slice(0, 16)
        : undefined,
  };
}

/**
 * The configuration of the gateway -> its controllers (at most
 * LIMITS.controllers) and their outputs (at most LIMITS.outputsPerController
 * each). An output id seen twice on a controller keeps its first definition.
 * @returns {{ controllers: object[], dropped: number } | { error: string }}
 */
export function parseConfig(payload) {
  const parsed = parseJson(payload, LIMITS.configBytes);
  if (parsed.error) {
    return { error: parsed.error };
  }
  const devices = own(parsed.value, 'devices');
  if (!Array.isArray(devices) || devices.length === 0) {
    return { error: 'no controller' };
  }
  const controllers = [];
  let dropped = 0;
  for (const raw of devices.slice(0, LIMITS.controllers)) {
    const id = own(raw, 'id');
    const serial = own(raw, 'serialNr');
    if (!isId(id) || typeof serial !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(serial)) {
      dropped += 1;
      continue;
    }
    if (controllers.some((c) => c.id === id || c.serial === serial)) {
      dropped += 1;
      continue;
    }
    const controller = {
      id,
      serial,
      version: text(own(raw, 'version'), 32),
      outputs: [],
    };
    const blocks = own(raw, 'functionBlocks');
    const seen = new Set();
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (controller.outputs.length >= LIMITS.outputsPerController) {
        dropped += 1;
        continue;
      }
      const output = parseOutput(block, controller);
      if (!output || seen.has(output.id) || seen.has(`ref:${output.ref}`)) {
        dropped += 1;
        continue;
      }
      seen.add(output.id);
      seen.add(`ref:${output.ref}`);
      controller.outputs.push(output);
    }
    controllers.push(controller);
  }
  dropped += Math.max(0, devices.length - LIMITS.controllers);
  return { controllers, dropped };
}

/**
 * What a topic is about.
 * @returns {{ kind: 'config' | 'gateway' } | { kind: 'controller', controllerId }
 *   | { kind: 'output', controllerId, outputId } | undefined}
 */
export function parseTopic(topic) {
  if (typeof topic !== 'string' || !topic.startsWith(`${TOPIC_PREFIX}/`)) {
    return undefined;
  }
  const parts = topic.slice(TOPIC_PREFIX.length + 1).split('/');
  if (parts.length === 1) {
    if (parts[0] === 'config') {
      return { kind: 'config' };
    }
    return parts[0] === 'state' ? { kind: 'gateway' } : undefined;
  }
  if (parts.length === 2 && parts[1] === 'state' && isId(parts[0])) {
    return { kind: 'controller', controllerId: parts[0] };
  }
  if (parts.length === 3 && parts[2] === 'state' && isId(parts[0]) && isId(parts[1])) {
    return { kind: 'output', controllerId: parts[0], outputId: parts[1] };
  }
  return undefined;
}

/** The gateway state: { online: boolean | undefined, reason }. */
export function parseGatewayState(payload) {
  const parsed = parseJson(payload, LIMITS.stateBytes);
  if (parsed.error || !isObject(parsed.value)) {
    return { error: parsed.error ?? 'not an object' };
  }
  const online = own(parsed.value, 'online');
  return {
    online: typeof online === 'boolean' ? online : undefined,
    reason: text(own(parsed.value, 'reason'), 100) || undefined,
  };
}

/** A controller state: { connected, connectable } (booleans or undefined). */
export function parseControllerState(payload) {
  const parsed = parseJson(payload, LIMITS.stateBytes);
  if (parsed.error || !isObject(parsed.value)) {
    return { error: parsed.error ?? 'not an object' };
  }
  const properties = own(parsed.value, 'properties');
  const bool = (key) =>
    typeof own(properties, key) === 'boolean' ? own(properties, key) : undefined;
  return { connected: bool('connected'), connectable: bool('connectable') };
}

/** The properties a state may carry, and the type each must have. */
const PROPERTY_TYPES = {
  value: ['boolean', 'number'],
  state: ['string'],
  shutterPosition: ['number'],
  slatPosition: ['number'],
  setTemp: ['number'],
  currTemp: ['number'],
  currRegime: ['string'],
  co2: ['number'],
  on: ['boolean'],
  brightness: ['number'],
  hue: ['number'],
  saturation: ['number'],
  currentValue: ['number'],
  temperature: ['number'],
  light: ['number'],
  wind: ['number'],
  raining: ['boolean', 'string'],
};

/**
 * An output state: { type: 'state' | 'event' | ..., properties: Map }. Only
 * the known properties, of the expected type (numbers finite), are kept.
 */
export function parseOutputState(payload) {
  const parsed = parseJson(payload, LIMITS.stateBytes);
  if (parsed.error || !isObject(parsed.value)) {
    return { error: parsed.error ?? 'not an object' };
  }
  const type = own(parsed.value, 'type');
  const raw = own(parsed.value, 'properties');
  const properties = new Map();
  for (const [key, types] of Object.entries(PROPERTY_TYPES)) {
    const value = own(raw, key);
    if (value === undefined || !types.includes(typeof value)) {
      continue;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      continue;
    }
    properties.set(key, typeof value === 'string' ? value.slice(0, 32) : value);
  }
  return { type: typeof type === 'string' ? type.slice(0, 16) : '', properties };
}

// --- What is sent ----------------------------------------------------------

/** Ask for the states of these ids (controllers or outputs), in chunks. */
export function stateRequests(ids) {
  const requests = [];
  for (let i = 0; i < ids.length; i += LIMITS.idsPerRequest) {
    requests.push({
      topic: TOPICS.getState,
      payload: JSON.stringify(ids.slice(i, i + LIMITS.idsPerRequest)),
    });
  }
  return requests;
}

/**
 * Activate a controller that reports `connectable: false` (qbusmqttapi
 * create_device_activate_request: the fixed key of the Qbus protocol, not a
 * secret of the user).
 */
export function activateRequest(controllerId) {
  return {
    topic: TOPICS.controllerCommand(controllerId),
    payload: JSON.stringify({
      id: controllerId,
      type: 'action',
      action: 'activate',
      properties: { authKey: 'ubielite' },
    }),
  };
}

/** A command to an output: a "state" with properties, or an "action". */
export function outputCommand(output, { type = 'state', action, properties }) {
  const body = { id: output.id, type };
  if (action !== undefined) {
    body.action = action;
  }
  if (properties !== undefined) {
    body.properties = properties;
  }
  return {
    topic: TOPICS.outputCommand(output.controller.id, output.id),
    payload: JSON.stringify(body),
  };
}
