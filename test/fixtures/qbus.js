// A Qbus MQTT gateway with one controller, written for these tests after the
// shapes qbusmqttapi parses (no real installation behind it).

export const PREFIX = 'cloudapp/QBUSMQTTGW';
export const CTD = 'UL1';
export const SERIAL = '000123';

const number = (min, max, step, extra = {}) => ({
  read: true,
  write: true,
  type: 'number',
  min,
  max,
  step,
  ...extra,
});

export const OUTPUTS = {
  relay: {
    id: 'UL10',
    refId: `${SERIAL}/10`,
    type: 'onoff',
    name: 'Kitchen',
    location: 'Kitchen',
    actions: { on: null, off: null },
    properties: { value: { read: true, write: true, type: 'boolean' } },
  },
  dimmer: {
    id: 'UL15',
    refId: `${SERIAL}/28`,
    type: 'analog',
    name: 'Living dimmer',
    actions: { on: null, off: null },
    properties: { value: number(5, 100, 0.1) },
  },
  colour: {
    id: 'UL100',
    refId: `${SERIAL}/32101`,
    type: 'multicolor',
    name: 'TV strip',
    properties: {
      on: { read: true, write: true, type: 'boolean' },
      brightness: number(0, 100, 0.1),
      hue: number(0, 360, 0.1),
      saturation: number(0, 100, 0.1),
    },
  },
  blind: {
    id: 'UL30',
    refId: `${SERIAL}/108`,
    type: 'shutter',
    name: 'Curtains',
    actions: { shutterUp: null, shutterDown: null, shutterStop: null },
    properties: {
      state: { read: true, write: false, type: 'enumString', enumValues: ['up', 'stop', 'down'] },
    },
  },
  shutter: {
    id: 'UL31',
    refId: `${SERIAL}/109`,
    type: 'shutter',
    name: 'Bedroom shutter',
    actions: { shutterStop: null },
    properties: { shutterPosition: number(0, 100, 1), slatPosition: number(0, 100, 1) },
  },
  thermostat: {
    id: 'UL20',
    refId: `${SERIAL}/120`,
    type: 'thermo',
    name: 'Living TH',
    properties: {
      currRegime: {
        read: true,
        write: true,
        type: 'enumString',
        enumValues: ['MANUEEL', 'VORST', 'COMFORT'],
      },
      currTemp: { ...number(0, 35, 0.5), write: false },
      setTemp: number(0, 35, 0.5),
    },
  },
  scene: {
    id: 'UL25',
    refId: `${SERIAL}/105/3`,
    type: 'scene',
    name: 'Watching TV',
    actions: { active: null },
    properties: {},
  },
  temperature: {
    id: 'UL40',
    refId: `${SERIAL}/81`,
    type: 'gauge',
    variant: 'Temperature',
    name: 'Garden temperature',
    properties: { currentValue: { read: true, write: false, type: 'number', unit: '°C' } },
  },
  power: {
    id: 'UL41',
    refId: `${SERIAL}/82`,
    type: 'gauge',
    variant: 'Power',
    name: 'Heat pump power',
    properties: { currentValue: { read: true, write: false, type: 'number', unit: 'W' } },
  },
  energy: {
    id: 'UL42',
    refId: `${SERIAL}/83`,
    type: 'gauge',
    variant: 'Energy',
    name: 'Energy',
    properties: { currentValue: { read: true, write: false, type: 'number', unit: 'Wh' } },
  },
  humidity: {
    id: 'UL80',
    refId: `${SERIAL}/94/1`,
    type: 'humidity',
    name: 'Kitchen humidity',
    properties: { value: { read: true, write: false, type: 'percent' } },
  },
  ventilation: {
    id: 'UL70',
    refId: `${SERIAL}/224`,
    type: 'ventilation',
    name: 'Air sensor',
    properties: { co2: { read: true, write: false, type: 'number', unit: 'ppm' } },
  },
  weather: {
    id: 'UL60',
    refId: `${SERIAL}/21007`,
    type: 'weatherstation',
    name: 'Weather',
    properties: {
      temperature: { read: true, type: 'number' },
      light: { read: true, type: 'number' },
      wind: { read: true, type: 'number' },
      raining: { read: true, type: 'boolean' },
    },
  },
  stepper: {
    id: 'UL90',
    refId: `${SERIAL}/68`,
    type: 'stepper',
    name: 'Stepper',
    properties: {
      value: { read: true, write: true, type: 'number', valueList: [{ name: '0', value: 0 }] },
    },
  },
};

export const controller = (outputs = Object.values(OUTPUTS), extra = {}) => ({
  id: CTD,
  ip: '192.168.1.123',
  mac: '001122334455',
  serialNr: SERIAL,
  type: 'Qbus',
  version: '3.14.0',
  functionBlocks: outputs,
  ...extra,
});

export const config = (controllers = [controller()]) => ({ app: 'abc', devices: controllers });

export const topic = {
  config: `${PREFIX}/config`,
  gateway: `${PREFIX}/state`,
  controller: (id = CTD) => `${PREFIX}/${id}/state`,
  output: (outputId, ctd = CTD) => `${PREFIX}/${ctd}/${outputId}/state`,
  command: (outputId, ctd = CTD) => `${PREFIX}/${ctd}/${outputId}/setState`,
};

export const state = (outputId, properties, type = 'state') => ({ id: outputId, type, properties });

export const ID = (ref) => `ext:test-integration:output:${SERIAL}-${ref}`;
