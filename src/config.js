// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form. The password of
// the broker is kept here and in the MQTT client only: never logged, never in
// /data, never in a status or an error.
// -----------------------------------------------------------------------------

import { SENSOR_INTERVAL, SETPOINT } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  broker_url: '',
  username: '',
  password: '',
  verify_certificate: true,
  controller_serial: '',
  allow_setpoints: false,
  max_setpoint: SETPOINT.ceilingDefault,
  sensor_interval: SENSOR_INTERVAL.default,
  language: 'fr',
};

const SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:', 'tcp:', 'ssl:'];

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';
/** Only `false` (or the text "false") turns off: a missing value keeps the safe default. */
const strictFalse = (value) => value === false || value === 'false';

/** A number typed in the form: a finite number, or undefined ('' and null are not 0). */
export function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d{1,6}(\.\d{1,6})?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/**
 * The broker URL, completed: "192.168.1.10" -> "mqtt://192.168.1.10".
 * @returns {{ url: string } | { error: string }}
 */
export function parseBrokerUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { error: 'empty' };
  }
  if (text.length > 300) {
    return { error: 'invalid' };
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!SCHEMES.includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials belong to their own fields (the secret one is never shown again).
    return { error: 'credentials' };
  }
  return { url: url.toString().replace(/\/$/, '') };
}

/** The serial number of one controller (digits, as Qbus prints them), or undefined for all. */
export function parseSerial(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { serial: undefined };
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(text)) {
    return { error: 'invalid' };
  }
  return { serial: text };
}

/**
 * The setpoint ceiling: whole degrees between SETPOINT.ceilingMin and
 * SETPOINT.max, else the default (24 °C). Never above 30 °C, whatever was typed.
 */
export function ceilingOf(value) {
  const number = numberOf(value);
  if (number === undefined) {
    return SETPOINT.ceilingDefault;
  }
  return Math.min(SETPOINT.max, Math.max(SETPOINT.ceilingMin, Math.floor(number)));
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(c, key) && value !== null && value !== undefined) {
      c[key] = value;
    }
  }
  const broker = parseBrokerUrl(c.broker_url);
  const serial = parseSerial(c.controller_serial);
  const interval = numberOf(c.sensor_interval);
  const password = typeof c.password === 'string' ? c.password : '';
  let problem = broker.error ? `broker:${broker.error}` : undefined;
  if (!problem && serial.error) {
    problem = 'serial';
  } else if (!problem && password.length > 1024) {
    problem = 'password';
  }
  return {
    /** Why the configuration cannot be used (shown in the status), else undefined. */
    problem,
    brokerUrl: broker.url,
    username: typeof c.username === 'string' ? c.username.trim().slice(0, 256) : '',
    password: problem ? '' : password,
    // TLS certificates are checked unless the user turns it off.
    verifyCertificate: !strictFalse(c.verify_certificate),
    serial: serial.serial,
    allowSetpoints: strictTrue(c.allow_setpoints),
    ceiling: ceilingOf(c.max_setpoint),
    sensorInterval:
      interval === undefined
        ? SENSOR_INTERVAL.default
        : Math.min(SENSOR_INTERVAL.max, Math.max(SENSOR_INTERVAL.min, Math.round(interval))),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}

/** What a reconnection to the broker depends on (compared in memory only, never stored). */
export const connectionKey = (config) =>
  JSON.stringify([
    config.problem ?? null,
    config.brokerUrl ?? null,
    config.username,
    config.password,
    config.verifyCertificate,
    config.serial ?? null,
  ]);

/** The credentials only: other credentials lift the stop on refused credentials. */
export const credentialsKey = (config) =>
  JSON.stringify([config.brokerUrl ?? null, config.username, config.password]);
