// -----------------------------------------------------------------------------
// The outputs of the Qbus controllers -> Gladys devices and routing tables.
// Pure: same configuration, same devices.
//
// What an output becomes, by its Qbus type (as Home Assistant's Qbus
// integration maps them, ported from its light, switch, cover, climate,
// scene and sensor platforms; Apache-2.0):
//   onoff           switch: on/off (a relay)
//   analog          light: on/off and brightness (a dimmer)
//   multicolor      light: on/off, brightness and colour
//   shutter         shutter: open/close/stop, and its position when the
//                   controller reports one (never a switch)
//   thermo          thermostat: the room temperature and the setpoint (never
//                   a switch); the setpoint is refused unless the
//                   configuration allows it, and bounded
//   scene           a push button "Run"
//   gauge           a sensor, by its variant (temperature, humidity, CO2,
//                   light, pressure, power, current, voltage, wind)
//   humidity        a humidity sensor
//   ventilation     its CO2 sensor
//   weatherstation  temperature, light, wind and rain
// Not offered in v1: steppers, the regimes (presets) of thermostats,
// ventilations and humidity outputs, the slats of venetian blinds, the
// effects of colour lights, and the cumulative gauges (energy, water, gas,
// volume: an index needs the guard of the energy indexes).
//
// External ids (frozen: never change one):
//   device   ext:<selector>:output:<controller serial>-<ref>, <ref> being the
//            number Qbus System Manager gives the output ("000001/10" -> "10",
//            "000001/105/3" -> "105-3"), as Home Assistant keys its entities
//   feature  <device>:<role> (src/constants.js FEATURES)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { COVER_STATE, FEATURES as F, LIMITS, PRESSED, SETPOINT } from './constants.js';
import { featureName } from './i18n.js';

/** A number sent by Gladys: a finite number, or a plain decimal text ('' and null are not 0). */
export function strictNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d{1,9}(\.\d{1,6})?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** A refusal of a command value (the app turns the key into a message). */
export class CommandRefusal extends Error {
  constructor(key) {
    super(key);
    this.refusal = key;
  }
}
const refuse = (key) => {
  throw new CommandRefusal(key);
};

const onOff = (value) => {
  const v = strictNumber(value);
  if (v !== 0 && v !== 1) {
    refuse('badValue');
  }
  return v === 1;
};

const percent = (value) => {
  const v = strictNumber(value);
  if (v === undefined || v < 0 || v > 100) {
    refuse('badValue');
  }
  return Math.round(v);
};

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

// --- Colours (Gladys: an RGB integer; Qbus: hue 0–360 and saturation 0–100) ---

export function hsToRgb(hue, saturation) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const s = clamp(saturation, 0, 100) / 100;
  const c = s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = 1 - c;
  const byte = (v) => Math.round((v + m) * 255);
  return (byte(r) << 16) + (byte(g) << 8) + byte(b);
}

export function rgbToHs(rgb) {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) {
      hue = 60 * (((g - b) / d) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / d + 2);
    } else {
      hue = 60 * ((r - g) / d + 4);
    }
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  return { hue: round1((hue + 360) % 360), saturation: round1(max === 0 ? 0 : (d / max) * 100) };
}

// --- Gauges ------------------------------------------------------------------

/** Gauge variants: Gladys category, type, and the Qbus unit -> Gladys unit (first = default). */
const GAUGES = {
  TEMPERATURE: {
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    units: { '°c': 'celsius', c: 'celsius' },
  },
  HUMIDITY: { category: C.HUMIDITY_SENSOR, type: T.SENSOR.DECIMAL, units: { '%': 'percent' } },
  AIRQUALITY: { category: C.CO2_SENSOR, type: T.SENSOR.DECIMAL, units: { ppm: 'ppm' } },
  LIGHT: { category: C.LIGHT_SENSOR, type: T.SENSOR.DECIMAL, units: { lx: 'lux', lux: 'lux' } },
  AIRPRESSURE: {
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    units: { mbar: 'milli-bar', hpa: 'hPa' },
  },
  WATERPRESSURE: {
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    units: { mbar: 'milli-bar', bar: 'bar', kpa: 'kPa' },
  },
  PRESSURE: {
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    units: { kpa: 'kPa', bar: 'bar', mbar: 'milli-bar', hpa: 'hPa', pa: 'pascal', psi: 'psi' },
  },
  POWER: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    units: { kw: 'kilowatt', w: 'watt' },
  },
  CURRENT: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    units: { a: 'ampere', ma: 'milliampere' },
  },
  VOLTAGE: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    units: { v: 'volt', mv: 'millivolt' },
  },
  WIND: {
    category: C.SPEED_SENSOR,
    type: T.SPEED_SENSOR.DECIMAL,
    units: { 'km/h': 'kilometer-per-hour', 'm/s': 'meter-per-second' },
  },
};

/** The Gladys unit of a gauge: its declared unit if known, the default if none; undefined if unknown. */
export function gaugeUnit(spec, qbusUnit) {
  const units = Object.entries(spec.units);
  if (qbusUnit === undefined || qbusUnit.trim() === '') {
    return units[0][1];
  }
  const found = units.find(([key]) => key === qbusUnit.trim().toLowerCase());
  return found ? found[1] : undefined;
}

// --- Readers: a state's properties -> the Gladys value of a feature ----------

const number =
  (key, scale = 1) =>
  (props) =>
    typeof props.get(key) === 'number' ? props.get(key) * scale : undefined;

/** The Gladys shutter state from the Qbus state, or from the position when the state is absent. */
function shutterState(props) {
  const state = props.get('state');
  if (state === 'up') {
    return COVER_STATE.OPEN;
  }
  if (state === 'down') {
    return COVER_STATE.CLOSE;
  }
  if (state === 'stop') {
    return COVER_STATE.STOP;
  }
  return undefined;
}

// --- Features ----------------------------------------------------------------

function feature(role, spec) {
  return { role, measurement: false, readOnly: true, ...spec };
}

/** The features of an output, with how to read and write each; [] when not offered. */
export function outputFeatures(output) {
  const { has, limits } = output;
  switch (output.type) {
    case 'onoff':
      return [
        feature(F.POWER, {
          category: C.SWITCH,
          type: T.SWITCH.BINARY,
          min: 0,
          max: 1,
          readOnly: false,
          read: (p) => (typeof p.get('value') === 'boolean' ? (p.get('value') ? 1 : 0) : undefined),
          write: (value) => ({ properties: { value: onOff(value) } }),
        }),
      ];
    case 'analog': {
      const low = clamp(Math.ceil(limits.value.min ?? 1), 1, 100);
      return [
        feature(F.POWER, {
          category: C.LIGHT,
          type: T.LIGHT.BINARY,
          min: 0,
          max: 1,
          readOnly: false,
          read: (p) =>
            typeof p.get('value') === 'number' ? (p.get('value') > 0 ? 1 : 0) : undefined,
          write: (value) => ({ type: 'action', action: onOff(value) ? 'on' : 'off' }),
        }),
        feature(F.BRIGHTNESS, {
          category: C.LIGHT,
          type: T.LIGHT.BRIGHTNESS,
          min: 0,
          max: 100,
          unit: 'percent',
          readOnly: false,
          read: (p) =>
            typeof p.get('value') === 'number'
              ? clamp(Math.round(p.get('value')), 0, 100)
              : undefined,
          write: (value) => {
            const v = percent(value);
            return v === 0
              ? { type: 'action', action: 'off' }
              : { properties: { value: Math.max(low, v) } };
          },
        }),
      ];
    }
    case 'multicolor':
      return [
        feature(F.POWER, {
          category: C.LIGHT,
          type: T.LIGHT.BINARY,
          min: 0,
          max: 1,
          readOnly: false,
          read: (p) => (typeof p.get('on') === 'boolean' ? (p.get('on') ? 1 : 0) : undefined),
          write: (value) => ({ properties: { on: onOff(value) } }),
        }),
        feature(F.BRIGHTNESS, {
          category: C.LIGHT,
          type: T.LIGHT.BRIGHTNESS,
          min: 0,
          max: 100,
          unit: 'percent',
          readOnly: false,
          read: (p) =>
            typeof p.get('brightness') === 'number'
              ? clamp(Math.round(p.get('brightness')), 0, 100)
              : undefined,
          write: (value) => {
            const v = percent(value);
            return v === 0 ? { properties: { on: false } } : { properties: { brightness: v } };
          },
        }),
        feature(F.COLOR, {
          category: C.LIGHT,
          type: T.LIGHT.COLOR,
          min: 0,
          max: 16777215,
          readOnly: false,
          read: (p) =>
            typeof p.get('hue') === 'number' && typeof p.get('saturation') === 'number'
              ? hsToRgb(p.get('hue'), p.get('saturation'))
              : undefined,
          write: (value) => {
            const v = strictNumber(value);
            if (!Number.isInteger(v) || v < 0 || v > 16777215) {
              refuse('badValue');
            }
            return { properties: rgbToHs(v) };
          },
        }),
      ];
    case 'shutter': {
      const positioned = has.shutterPosition;
      const features = [
        feature(F.SHUTTER, {
          category: C.SHUTTER,
          type: T.SHUTTER.STATE,
          min: -1,
          max: 1,
          readOnly: false,
          read: shutterState,
          write: (value) => {
            const v = strictNumber(value);
            if (v === COVER_STATE.STOP) {
              return { properties: { state: 'stop' } };
            }
            if (v === COVER_STATE.OPEN) {
              return { properties: positioned ? { shutterPosition: 100 } : { state: 'up' } };
            }
            if (v === COVER_STATE.CLOSE) {
              return {
                properties: positioned
                  ? { shutterPosition: 0, ...(has.slatPosition ? { slatPosition: 0 } : {}) }
                  : { state: 'down' },
              };
            }
            return refuse('badValue');
          },
        }),
      ];
      if (positioned) {
        features.push(
          feature(F.POSITION, {
            category: C.SHUTTER,
            type: T.SHUTTER.POSITION,
            min: 0,
            max: 100,
            unit: 'percent',
            readOnly: false,
            read: (p) =>
              typeof p.get('shutterPosition') === 'number'
                ? clamp(Math.round(p.get('shutterPosition')), 0, 100)
                : undefined,
            write: (value) => ({ properties: { shutterPosition: percent(value) } }),
          }),
        );
      }
      return features;
    }
    case 'thermo':
      return [
        feature(F.TEMPERATURE, {
          category: C.TEMPERATURE_SENSOR,
          type: T.SENSOR.DECIMAL,
          unit: 'celsius',
          min: -20,
          max: 60,
          measurement: true,
          read: number('currTemp'),
        }),
        // Writable in Gladys, but every command is refused unless the
        // configuration allows setpoints (src/app.js), and bounded.
        feature(F.TARGET, {
          category: C.THERMOSTAT,
          type: T.THERMOSTAT.TARGET_TEMPERATURE,
          unit: 'celsius',
          min: SETPOINT.min,
          max: SETPOINT.max,
          readOnly: false,
          setpoint: true,
          read: number('setTemp'),
        }),
      ];
    case 'scene':
      return [
        feature(F.SCENE, {
          category: C.BUTTON,
          type: T.BUTTON.PUSH,
          min: 0,
          max: 1,
          readOnly: false,
          history: false,
          write: (value) => {
            if (strictNumber(value) !== PRESSED) {
              refuse('badValue');
            }
            return { type: 'action', action: 'active' };
          },
        }),
      ];
    case 'gauge': {
      const spec = GAUGES[output.variant];
      const unit = spec && gaugeUnit(spec, output.unit);
      if (!spec || !unit) {
        return [];
      }
      return [
        feature(F.VALUE, {
          category: spec.category,
          type: spec.type,
          unit,
          measurement: true,
          read: number('currentValue'),
        }),
      ];
    }
    case 'humidity':
      return [
        feature(F.VALUE, {
          category: C.HUMIDITY_SENSOR,
          type: T.SENSOR.DECIMAL,
          unit: 'percent',
          min: 0,
          max: 100,
          measurement: true,
          read: number('value'),
        }),
      ];
    case 'ventilation':
      return has.co2
        ? [
            feature(F.CO2, {
              category: C.CO2_SENSOR,
              type: T.SENSOR.DECIMAL,
              unit: 'ppm',
              min: 0,
              max: 10000,
              measurement: true,
              read: number('co2'),
            }),
          ]
        : [];
    case 'weatherstation':
      return [
        feature(F.WEATHER_TEMPERATURE, {
          category: C.TEMPERATURE_SENSOR,
          type: T.SENSOR.DECIMAL,
          unit: 'celsius',
          min: -50,
          max: 70,
          measurement: true,
          read: number('temperature'),
        }),
        // The weather station reports kilolux (Home Assistant multiplies by 1000).
        feature(F.WEATHER_LIGHT, {
          category: C.LIGHT_SENSOR,
          type: T.SENSOR.DECIMAL,
          unit: 'lux',
          min: 0,
          max: 200000,
          measurement: true,
          read: number('light', 1000),
        }),
        feature(F.WEATHER_WIND, {
          category: C.SPEED_SENSOR,
          type: T.SPEED_SENSOR.DECIMAL,
          unit: 'kilometer-per-hour',
          min: 0,
          max: 300,
          measurement: true,
          read: number('wind'),
        }),
        feature(F.WEATHER_RAIN, {
          category: C.RAIN_SENSOR,
          type: T.SENSOR.BINARY,
          min: 0,
          max: 1,
          read: (p) => {
            const v = p.get('raining');
            if (typeof v === 'boolean') {
              return v ? 1 : 0;
            }
            return v === 'true' ? 1 : v === 'false' ? 0 : undefined;
          },
        }),
      ];
    default:
      return [];
  }
}

/**
 * @param {{ externalIds: Function, controllers: object[], language: string }} input
 * @returns {{ devices, features, outputs, deviceOf, throttled }}
 *   features: featureId -> { output, spec, deviceId }
 *   outputs: "<controller id>/<output id>" -> { output, deviceId, features: [featureId] }
 *   deviceOf: deviceId -> output
 */
export function buildModel({ externalIds, controllers = [], language = 'fr' }) {
  const model = {
    devices: [],
    features: new Map(),
    outputs: new Map(),
    deviceOf: new Map(),
    throttled: new Set(),
  };
  for (const controller of controllers) {
    for (const output of controller.outputs) {
      const specs = outputFeatures(output);
      if (specs.length === 0) {
        continue;
      }
      const ids = externalIds('output', `${controller.serial}-${output.ref}`);
      if (model.deviceOf.has(ids.device)) {
        continue;
      }
      const featureIds = [];
      const features = specs.map((spec) => {
        const featureId = ids.feature(spec.role);
        featureIds.push(featureId);
        model.features.set(featureId, { output, spec, deviceId: ids.device });
        if (spec.measurement) {
          model.throttled.add(featureId);
        }
        return {
          name: featureName(spec.role, language),
          external_id: featureId,
          category: spec.category,
          type: spec.type,
          ...(spec.unit ? { unit: spec.unit } : {}),
          ...(spec.min !== undefined ? { min: spec.min } : {}),
          ...(spec.max !== undefined ? { max: spec.max } : {}),
          read_only: spec.readOnly,
          has_feedback: spec.read !== undefined,
          keep_history: spec.history !== false,
        };
      });
      model.devices.push({
        name: output.name.slice(0, LIMITS.nameLength),
        external_id: ids.device,
        params: [
          { name: 'QBUS_CONTROLLER', value: controller.serial },
          { name: 'QBUS_OUTPUT', value: output.ref },
          { name: 'QBUS_TYPE', value: output.type },
          ...(output.location ? [{ name: 'QBUS_LOCATION', value: output.location }] : []),
        ],
        features,
      });
      model.deviceOf.set(ids.device, output);
      model.outputs.set(`${controller.id}/${output.id}`, {
        output,
        deviceId: ids.device,
        features: featureIds,
      });
    }
  }
  return model;
}
