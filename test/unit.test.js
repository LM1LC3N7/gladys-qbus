// The pure parts: protocol, model, configuration, memory, MQTT errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ceilingOf, normalizeConfig, parseBrokerUrl, parseSafeOutputs } from '../src/config.js';
import { LIMITS, TIMINGS } from '../src/constants.js';
import { buildModel, gaugeUnit, hsToRgb, outputFeatures, rgbToHs } from '../src/model.js';
import { errorReason, isRefusal } from '../src/mqtt.js';
import {
  formatRefId,
  outputCommand,
  parseConfig,
  parseControllerState,
  parseOutputState,
  parseTopic,
  stateRequests,
} from '../src/protocol.js';
import { authWait, normalizeMemory, serializeMemory } from '../src/store.js';
import { OUTPUTS, SERIAL, config, controller } from './fixtures/qbus.js';

const externalIds = (type, id) => ({
  device: `ext:t:${type}:${id}`,
  feature: (key) => `ext:t:${type}:${id}:${key}`,
});

test('refIds as Home Assistant formats them', () => {
  assert.equal(formatRefId('000001/10'), '10');
  assert.equal(formatRefId('000001/105/3'), '105-3');
  for (const bad of [
    '10',
    '000001/',
    'a/1',
    '000001/1/2/3',
    12,
    undefined,
    `1/${'9'.repeat(80)}`,
  ]) {
    assert.equal(formatRefId(bad), undefined, String(bad));
  }
});

test('topics', () => {
  assert.deepEqual(parseTopic('cloudapp/QBUSMQTTGW/config'), { kind: 'config' });
  assert.deepEqual(parseTopic('cloudapp/QBUSMQTTGW/state'), { kind: 'gateway' });
  assert.deepEqual(parseTopic('cloudapp/QBUSMQTTGW/UL1/state'), {
    kind: 'controller',
    controllerId: 'UL1',
  });
  assert.deepEqual(parseTopic('cloudapp/QBUSMQTTGW/UL1/UL10/state'), {
    kind: 'output',
    controllerId: 'UL1',
    outputId: 'UL10',
  });
  for (const bad of [
    'other/UL1/state',
    'cloudapp/QBUSMQTTGW/UL1/UL10/setState',
    'cloudapp/QBUSMQTTGW/U+/state',
  ]) {
    assert.equal(parseTopic(bad), undefined, bad);
  }
});

test('the configuration is bounded', () => {
  const many = Array.from({ length: LIMITS.outputsPerController + 5 }, (_, i) => ({
    id: `UL${i}`,
    refId: `${SERIAL}/${i}`,
    type: 'onoff',
    name: `R${i}`,
  }));
  const parsed = parseConfig(Buffer.from(JSON.stringify(config([controller(many)]))));
  assert.equal(parsed.controllers[0].outputs.length, LIMITS.outputsPerController);
  assert.equal(parsed.dropped, 5);
  const ctds = Array.from({ length: 10 }, (_, i) =>
    controller([], { id: `C${i}`, serialNr: `00000${i}` }),
  );
  assert.equal(parseConfig(JSON.stringify(config(ctds))).controllers.length, LIMITS.controllers);
  assert.equal(parseConfig('').error, 'empty');
  assert.equal(parseConfig('{"devices": []}').error, 'no controller');
  assert.equal(parseConfig('[1]').error, 'no controller');
  const dup = parseConfig(
    JSON.stringify(config([controller([OUTPUTS.relay, { ...OUTPUTS.relay, name: 'again' }])])),
  );
  assert.equal(dup.controllers[0].outputs.length, 1);
  assert.equal(dup.controllers[0].outputs[0].name, 'Kitchen');
  const long = parseConfig(
    JSON.stringify(config([controller([{ ...OUTPUTS.relay, name: `${'x'.repeat(59)} y` }])])),
  );
  assert.equal(long.controllers[0].outputs[0].name, 'x'.repeat(59), 'never a trailing space');
});

test('states keep only known properties of the right type', () => {
  const parsed = parseOutputState(
    JSON.stringify({
      id: 'UL1',
      type: 'state',
      properties: { value: true, setTemp: '21', currTemp: 19.5, extra: 1, shutterPosition: null },
    }),
  );
  assert.equal(parsed.type, 'state');
  assert.deepEqual(
    [...parsed.properties],
    [
      ['value', true],
      ['currTemp', 19.5],
    ],
  );
  assert.equal(parseOutputState('x'.repeat(LIMITS.stateBytes + 1)).error, 'too large');
  assert.deepEqual(parseControllerState('{"properties":{"connected":"yes","connectable":false}}'), {
    connected: undefined,
    connectable: false,
  });
});

test('what is sent', () => {
  const [output] = parseConfig(JSON.stringify(config([controller([OUTPUTS.thermostat])])))
    .controllers[0].outputs;
  assert.deepEqual(outputCommand(output, { properties: { setTemp: 21 } }), {
    topic: 'cloudapp/QBUSMQTTGW/UL1/UL20/setState',
    payload: '{"id":"UL20","type":"state","properties":{"setTemp":21}}',
  });
  const ids = Array.from({ length: 150 }, (_, i) => `UL${i}`);
  const requests = stateRequests(ids);
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].payload).length, LIMITS.idsPerRequest);
});

test('colours', () => {
  assert.equal(hsToRgb(0, 100), 0xff0000);
  assert.equal(hsToRgb(120, 100), 0x00ff00);
  assert.equal(hsToRgb(240, 100), 0x0000ff);
  assert.equal(hsToRgb(0, 0), 0xffffff);
  assert.deepEqual(rgbToHs(0x00ff00), { hue: 120, saturation: 100 });
  assert.deepEqual(rgbToHs(0xffffff), { hue: 0, saturation: 0 });
  assert.deepEqual(rgbToHs(0), { hue: 0, saturation: 0 });
});

test('gauges only with a unit the core knows', () => {
  const spec = { units: { kw: 'kilowatt', w: 'watt' } };
  assert.equal(gaugeUnit(spec, undefined), 'kilowatt');
  assert.equal(gaugeUnit(spec, 'W'), 'watt');
  assert.equal(gaugeUnit(spec, 'MW'), undefined);
  const [output] = parseConfig(
    JSON.stringify(
      config([controller([{ ...OUTPUTS.power, properties: { currentValue: { unit: 'MW' } } }])]),
    ),
  ).controllers[0].outputs;
  assert.deepEqual(outputFeatures(output), []);
});

test('the model: stable ids, no switch for shutters and thermostats', () => {
  const { controllers } = parseConfig(JSON.stringify(config()));
  const model = buildModel({ externalIds, controllers });
  assert.equal(model.devices.length, 12);
  for (const device of model.devices) {
    assert.match(device.external_id, new RegExp(`^ext:t:output:${SERIAL}-\\d+(-\\d+)?$`));
    for (const feature of device.features) {
      assert.ok(feature.external_id.startsWith(`${device.external_id}:`));
    }
  }
  const types = new Map(
    model.devices.map((d) => [d.params.find((p) => p.name === 'QBUS_TYPE').value, d]),
  );
  for (const type of ['shutter', 'thermo', 'scene']) {
    assert.ok(
      types.get(type).features.every((f) => f.category !== 'switch'),
      type,
    );
  }
  assert.equal(types.get('scene').features[0].type, 'push');
  // The language changes the names only, never an id.
  const en = buildModel({ externalIds, controllers, language: 'en' });
  assert.deepEqual(
    en.devices.map((d) => d.features.map((f) => f.external_id)),
    model.devices.map((d) => d.features.map((f) => f.external_id)),
  );
});

test('the configuration is normalized', () => {
  assert.deepEqual(parseBrokerUrl('192.168.1.2'), { url: 'mqtt://192.168.1.2' });
  assert.deepEqual(parseBrokerUrl('mqtts://broker.lan:8883'), { url: 'mqtts://broker.lan:8883' });
  assert.equal(parseBrokerUrl('mqtt://u:p@host').error, 'credentials');
  assert.equal(parseBrokerUrl('http://host').error, 'invalid');
  assert.equal(parseBrokerUrl(42).error, 'empty');
  assert.equal(ceilingOf(80), 30);
  assert.equal(ceilingOf(10), 16);
  assert.equal(ceilingOf(''), 24);
  assert.equal(ceilingOf('22.9'), 22);
  const c = normalizeConfig({
    broker_url: 'x',
    allow_setpoints: 'yes',
    verify_certificate: null,
    __proto__: { a: 1 },
  });
  assert.equal(c.allowSetpoints, false, 'only true allows');
  assert.equal(c.verifyCertificate, true, 'certificates checked unless turned off');
  assert.equal(normalizeConfig({ broker_url: 'x', allow_setpoints: true }).allowSetpoints, true);
  assert.equal(normalizeConfig({ broker_url: 'x', controller_serial: 'a/b' }).problem, 'serial');
  assert.equal(normalizeConfig({}).problem, 'broker:empty');
  assert.equal(normalizeConfig({ broker_url: 'x', sensor_interval: 9999 }).sensorInterval, 300);
});

test('the memory is bounded and holds no secret', () => {
  const now = 1_000_000;
  assert.deepEqual(normalizeMemory(null, now), { auth: { failures: 0, until: 0 } });
  assert.deepEqual(
    normalizeMemory({ auth: { failures: 2, until: now + 10 ** 12 } }, now).auth.until,
    now + TIMINGS.authRetry.at(-1),
  );
  assert.deepEqual(
    normalizeMemory(JSON.parse('{"__proto__":{"auth":{"failures":3}}}'), now).auth.failures,
    0,
  );
  assert.deepEqual(serializeMemory({ auth: { failures: 1, until: 5 }, password: 'x' }), {
    auth: { failures: 1, until: 5 },
  });
  assert.deepEqual([1, 2, 3, 4, 9].map(authWait), [...TIMINGS.authRetry, TIMINGS.authRetry.at(-1)]);
});

test('MQTT errors never carry a password', () => {
  assert.equal(errorReason({ code: 5 }), 'not authorized');
  assert.equal(isRefusal({ code: 134 }), true);
  assert.equal(isRefusal({ code: 'ECONNREFUSED' }), false);
  assert.equal(errorReason({ code: 'ECONNREFUSED' }), 'ECONNREFUSED');
  assert.doesNotMatch(errorReason(new Error('connect mqtt://user:secret@host failed')), /secret/);
});

test('I2: every published feature has a finite min and max, min <= max', () => {
  const { controllers } = parseConfig(JSON.stringify(config()));
  for (const safeOutputs of [new Set(), new Set(['10', '28'])]) {
    const model = buildModel({ externalIds, controllers, safeOutputs });
    for (const device of model.devices) {
      for (const f of device.features) {
        assert.ok(
          Number.isFinite(f.min) && Number.isFinite(f.max) && f.min <= f.max,
          f.external_id,
        );
      }
    }
  }
  const gauge = {
    ...OUTPUTS.temperature,
    properties: { currentValue: { unit: '°C', min: -30, max: 80 } },
  };
  const [output] = parseConfig(JSON.stringify(config([controller([gauge])]))).controllers[0]
    .outputs;
  assert.deepEqual([outputFeatures(output)[0].min, outputFeatures(output)[0].max], [-30, 80]);
  const bad = {
    ...OUTPUTS.temperature,
    properties: { currentValue: { unit: '°C', min: 90, max: 10 } },
  };
  const [o2] = parseConfig(JSON.stringify(config([controller([bad])]))).controllers[0].outputs;
  assert.deepEqual([outputFeatures(o2)[0].min, outputFeatures(o2)[0].max], [-50, 100]);
});

test('M4: never more than 2000 devices in the Discovery', () => {
  const ctds = Array.from({ length: 3 }, (_, k) =>
    controller(
      Array.from({ length: 1000 }, (_, i) => ({
        id: `U${k}x${i}`,
        refId: `00000${k}/${i}`,
        type: 'scene',
        name: `S${i}`,
      })),
      { id: `C${k}`, serialNr: `00000${k}` },
    ),
  );
  const model = buildModel({
    externalIds,
    controllers: parseConfig(JSON.stringify(config(ctds))).controllers,
  });
  assert.equal(model.devices.length, LIMITS.devices);
  assert.equal(model.capped, 1000);
});

test('B1: the safe list', () => {
  const { safe, invalid } = parseSafeOutputs('10, 28\n000123:105-3;lamp 1/2');
  assert.deepEqual([...safe], ['10', '28', '000123:105-3']);
  assert.deepEqual(invalid, ['lamp', '1/2']);
  assert.equal(parseSafeOutputs(undefined).safe.size, 0);
  assert.ok(parseSafeOutputs(Array.from({ length: 600 }, (_, i) => i).join(',')).safe.size <= 500);
});
