// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake broker playing the Qbus MQTT gateway. Timers are mocked:
// the debounces, the state flush, the command deadlines run when the test
// ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { QbusApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { SUBSCRIPTIONS, TOPICS } from '../src/protocol.js';
import { memoryStore } from '../src/store.js';
import {
  CTD,
  ID,
  OUTPUTS,
  PREFIX,
  SERIAL,
  config,
  controller,
  state,
  topic,
} from './fixtures/qbus.js';
import { fakeConnector, settle } from './helpers/fakeMqtt.js';

const START = 1_760_000_000_000;
/** The relay, the dimmer and the hostile relay of the fixture are declared safe. */
const BASE = { broker_url: '192.168.1.50', safe_outputs: '10, 28 13' };
const TH = ID('120');

/** A gateway answering getState: the controller connected, the thermostat at `setTemp`. */
function gateway(options = {}) {
  const g = {
    connected: true,
    setTemp: 20,
    answerStates: true,
    confirm: true,
    onGetState: undefined,
    others: {},
    ...options,
  };
  g.responder = (t, payload, client) => {
    if (t === TOPICS.getState && g.answerStates) {
      g.onGetState?.();
      for (const id of JSON.parse(payload)) {
        if (id === CTD) {
          client.deliver(topic.controller(), {
            id: CTD,
            properties: { connected: g.connected, connectable: true },
          });
        }
        if (id === OUTPUTS.thermostat.id) {
          client.deliver(
            topic.output(id),
            state(id, { setTemp: g.setTemp, currTemp: 19.5, currRegime: 'MANUEEL' }),
          );
        }
        if (Object.hasOwn(g.others, id)) {
          client.deliver(topic.output(id), state(id, { setTemp: g.others[id] }));
        }
      }
    }
    const other = Object.keys(g.others).find((id) => t === topic.command(id));
    if (other && g.confirm) {
      g.others[other] = JSON.parse(payload).properties.setTemp;
      client.deliver(topic.output(other), state(other, { setTemp: g.others[other] }, 'event'));
    }
    if (t === topic.command(OUTPUTS.thermostat.id) && g.confirm) {
      const body = JSON.parse(payload);
      g.setTemp = body.properties.setTemp;
      client.deliver(topic.output(body.id), state(body.id, { setTemp: g.setTemp }, 'event'));
    }
  };
  return g;
}

async function setup(t, { cfg = BASE, devices = [], memory = null, gw = gateway() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START });
  const gladys = createFakeGladys({ config: cfg, devices });
  const broker = fakeConnector(gw.responder);
  const store = memoryStore(memory);
  const app = new QbusApp({ gladys, connect: broker.connect, now: () => Date.now(), store });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, broker, store, gw, tick };
}

/** The broker connects and the gateway sends its configuration. */
async function online(ctx, payload = config()) {
  const client = ctx.broker.clients.at(-1);
  client.open();
  await settle();
  client.deliver(topic.config, payload);
  await ctx.tick(TIMINGS.stateRequestDelay);
  return client;
}

const discovered = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
const featureOf = (device, role) =>
  device.features.find((f) => f.external_id === `${device.external_id}:${role}`);

async function create(ctx, ref) {
  const device = discovered(ctx.gladys, ID(ref));
  assert.ok(device, `device ${ref} offered`);
  await ctx.gladys.fake.deviceCreated(device);
  return device;
}

/** A command: the ack, once the fake timers ran far enough. */
async function command(ctx, device, role, value, { ticks = [0] } = {}) {
  const ack = ctx.gladys.fake.setValue(device, featureOf(device, role), value);
  for (const ms of ticks) {
    await ctx.tick(ms);
  }
  return ack;
}

test('connects, asks the gateway, offers its outputs', async (t) => {
  const ctx = await setup(t);
  const client = ctx.broker.clients[0];
  assert.equal(client.config.brokerUrl, 'mqtt://192.168.1.50');
  client.open();
  await settle();
  assert.deepEqual([...client.subscriptions], SUBSCRIPTIONS);
  assert.deepEqual(
    client.published.map((p) => p.topic),
    [TOPICS.getConfig],
  );
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  client.deliver(topic.config, config());
  await ctx.tick(TIMINGS.stateRequestDelay);
  const devices = ctx.gladys.fake.discoveredDevices;
  // 14 outputs: the energy gauge (cumulative) and the stepper are not offered.
  assert.equal(devices.length, 12);
  assert.ok(!discovered(ctx.gladys, ID('83')) && !discovered(ctx.gladys, ID('68')));
  const ids = new Set(devices.map((d) => d.external_id));
  assert.equal(ids.size, devices.length);
  assert.ok(ids.has(ID('105-3')), 'the ref of a scene keeps its two levels');
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /1 controller\(s\), 12 device\(s\)/);
  const getState = client.published.filter((p) => p.topic === TOPICS.getState);
  assert.equal(getState.length, 1);
  assert.ok(JSON.parse(getState[0].payload).includes(CTD));
});

test('shutters and thermostats are never switches; the setpoint is a thermostat feature', async (t) => {
  const ctx = await setup(t);
  await online(ctx);
  for (const ref of ['108', '109', '120']) {
    const device = discovered(ctx.gladys, ID(ref));
    assert.ok(
      device.features.every((f) => f.category !== 'switch' && f.type !== 'binary'),
      ref,
    );
  }
  const th = discovered(ctx.gladys, TH);
  assert.deepEqual(
    th.features.map((f) => [f.category, f.type, f.unit, f.read_only]),
    [
      ['temperature-sensor', 'decimal', 'celsius', true],
      ['thermostat', 'target-temperature', 'celsius', false],
    ],
  );
  const blind = discovered(ctx.gladys, ID('108'));
  assert.deepEqual(
    blind.features.map((f) => f.type),
    ['state'],
    'no position without one',
  );
  assert.deepEqual(
    discovered(ctx.gladys, ID('109')).features.map((f) => f.type),
    ['state', 'position'],
  );
});

test('states reach Gladys once the device is created, measurements throttled', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const relay = await create(ctx, '10');
  const gauge = await create(ctx, '81');
  client.deliver(topic.output('UL10'), state('UL10', { value: true }));
  client.deliver(topic.output('UL40'), state('UL40', { currentValue: 12.5 }));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(ctx.gladys.fake.lastState(featureOf(relay, 'power').external_id), 1);
  assert.equal(ctx.gladys.fake.lastState(featureOf(gauge, 'value').external_id), 12.5);
  client.deliver(topic.output('UL40'), state('UL40', { currentValue: 13 }, 'event'));
  client.deliver(topic.output('UL10'), state('UL10', { value: false }, 'event'));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(
    ctx.gladys.fake.lastState(featureOf(relay, 'power').external_id),
    0,
    'on/off never throttled',
  );
  assert.equal(
    ctx.gladys.fake.lastState(featureOf(gauge, 'value').external_id),
    12.5,
    'measurement spaced',
  );
  await ctx.tick(10_000);
  assert.equal(ctx.gladys.fake.lastState(featureOf(gauge, 'value').external_id), 13);
});

test('the commands of lights, relays, shutters and scenes', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const cases = [
    ['10', 'power', 1, { id: 'UL10', type: 'state', properties: { value: true } }],
    ['28', 'power', 0, { id: 'UL15', type: 'action', action: 'off' }],
    ['28', 'brightness', 2, { id: 'UL15', type: 'state', properties: { value: 5 } }],
    ['28', 'brightness', 0, { id: 'UL15', type: 'action', action: 'off' }],
    [
      '32101',
      'color',
      0xff0000,
      { id: 'UL100', type: 'state', properties: { hue: 0, saturation: 100 } },
    ],
    ['32101', 'brightness', 40, { id: 'UL100', type: 'state', properties: { brightness: 40 } }],
    ['108', 'shutter', 1, { id: 'UL30', type: 'state', properties: { state: 'up' } }],
    ['108', 'shutter', 0, { id: 'UL30', type: 'state', properties: { state: 'stop' } }],
    [
      '109',
      'shutter',
      -1,
      { id: 'UL31', type: 'state', properties: { shutterPosition: 0, slatPosition: 0 } },
    ],
    ['109', 'position', 30, { id: 'UL31', type: 'state', properties: { shutterPosition: 30 } }],
    ['105-3', 'run', 1, { id: 'UL25', type: 'action', action: 'active' }],
  ];
  for (const [ref, role, value, body] of cases) {
    const before = client.commands().length;
    const ack = await command(ctx, discovered(ctx.gladys, ID(ref)), role, value);
    assert.equal(ack.success, true, `${ref} ${role} ${ack.error}`);
    const sent = client.commands().slice(before);
    assert.equal(sent.length, 1, `${ref} ${role}`);
    assert.deepEqual(sent[0].body, body, `${ref} ${role}`);
    assert.equal(sent[0].topic, `${PREFIX}/${CTD}/${body.id}/setState`);
  }
  for (const [ref, role, value] of [
    ['10', 'power', 2],
    ['10', 'power', ''],
    ['28', 'brightness', 101],
    ['108', 'shutter', 5],
    ['105-3', 'run', 0],
  ]) {
    const ack = await command(ctx, discovered(ctx.gladys, ID(ref)), role, value);
    assert.equal(ack.success, false, `${ref} ${role} ${value}`);
  }
  const ack = await command(ctx, discovered(ctx.gladys, ID('81')), 'value', 3);
  assert.equal(ack.success, false, 'a sensor is read-only');
});

test('nothing is queued while the broker is down', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  client.close();
  await settle();
  const before = client.published.length;
  const ack = await command(ctx, discovered(ctx.gladys, ID('108')), 'shutter', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas été envoyée/);
  assert.equal(client.published.length, before);
});

test('setpoints are refused by default, nothing sent', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const before = client.published.length;
  const ack = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /consigne sont désactivées/);
  assert.equal(client.published.length, before, 'not even a read');
});

const allowed = { broker_url: '192.168.1.50', allow_setpoints: true, language: 'en' };

test('an allowed setpoint: fresh read, sent, confirmed', async (t) => {
  const ctx = await setup(t, { cfg: allowed });
  const client = await online(ctx);
  const before = client.published.length;
  const ack = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 21.5);
  assert.equal(ack.success, true, ack.error);
  const sent = client.published.slice(before);
  assert.deepEqual(
    sent.map((p) => [p.topic, p.payload]),
    [
      [TOPICS.getState, JSON.stringify([CTD])],
      [TOPICS.getState, JSON.stringify(['UL20'])],
      [
        topic.command('UL20'),
        JSON.stringify({ id: 'UL20', type: 'state', properties: { setTemp: 21.5 } }),
      ],
    ],
  );
  // The same setpoint again: already so, nothing sent (once the guard saw it).
  const after = client.published.length;
  const again = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 21.5);
  assert.equal(again.success, true);
  assert.equal(client.commands().length, 1);
  assert.equal(client.published.length, after + 2, 'only the fresh read');
});

test('setpoints are bounded: ceiling, floor, step, thermostat limits', async (t) => {
  const ctx = await setup(t, { cfg: { ...allowed, max_setpoint: 22 } });
  const client = await online(ctx);
  const device = discovered(ctx.gladys, TH);
  for (const [value, pattern] of [
    [22.5, /between 5 and 22/],
    [4.5, /between 5 and 22/],
    [20.3, /steps of 0.5/],
    ['', /Not a temperature/],
    [null, /Not a temperature/],
    ['abc', /Not a temperature/],
  ]) {
    const ack = await command(ctx, device, 'target-temperature', value);
    assert.equal(ack.success, false, String(value));
    assert.match(ack.error, pattern, String(value));
  }
  assert.equal(client.commands().length, 0);
  // A ceiling typed above 30 °C stays at 30 °C.
  await ctx.gladys.fake.configUpdated({ ...allowed, max_setpoint: 80 });
  const ack = await command(ctx, device, 'target-temperature', 30.5);
  assert.match(ack.error, /between 5 and 30/);
});

test('a setpoint without a fresh answer is refused unsent', async (t) => {
  const ctx = await setup(t, { cfg: allowed, gw: gateway({ answerStates: false }) });
  const client = await online(ctx);
  const ack = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 21, {
    ticks: [0, 1000, 1000, 1000],
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /did not answer in time: the command was not sent/);
  assert.equal(client.commands().length, 0);
});

test('a setpoint is refused when the controller is offline in the fresh read', async (t) => {
  const ctx = await setup(t, { cfg: allowed, gw: gateway({ connected: false }) });
  const client = await online(ctx);
  const ack = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /controller is not connected/);
  assert.equal(client.commands().length, 0);
});

test('the option is checked again after the fresh read (beforeSend)', async (t) => {
  const gw = gateway();
  const ctx = await setup(t, { cfg: allowed, gw });
  const client = await online(ctx);
  // The answer of the gateway comes while the user turns the option off.
  gw.answerStates = false;
  const ack = ctx.gladys.fake.setValue(
    discovered(ctx.gladys, TH),
    featureOf(discovered(ctx.gladys, TH), 'target-temperature'),
    21,
  );
  await settle();
  await ctx.gladys.fake.configUpdated({ ...allowed, allow_setpoints: false });
  client.deliver(topic.controller(), { id: CTD, properties: { connected: true } });
  client.deliver(topic.output('UL20'), state('UL20', { setTemp: 20 }));
  await ctx.tick(0);
  const result = await ack;
  assert.equal(result.success, false);
  assert.match(result.error, /désactivées|off/);
  assert.equal(client.commands().length, 0);
});

test('a setpoint sent but not confirmed is "sent, without confirmation"', async (t) => {
  const ctx = await setup(t, { cfg: allowed, gw: gateway({ confirm: false }) });
  const client = await online(ctx);
  const ack = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 22, {
    ticks: [0, 1000, 1000, 1000, 1000, 500],
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Command sent, without confirmation/);
  assert.equal(client.commands().length, 1);
  // A second identical command is not skipped as "already so" while the guard runs.
  ctx.gw.setTemp = 20;
  const again = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 22, {
    ticks: [0, 1000, 1000, 1000, 1000, 500],
  });
  assert.equal(again.success, false);
  assert.equal(client.commands().length, 2);
});

test('one setpoint at a time', async (t) => {
  const ctx = await setup(t, { cfg: allowed, gw: gateway({ answerStates: false }) });
  await online(ctx);
  const device = discovered(ctx.gladys, TH);
  const first = ctx.gladys.fake.setValue(device, featureOf(device, 'target-temperature'), 21);
  await settle();
  const second = await ctx.gladys.fake.setValue(
    device,
    featureOf(device, 'target-temperature'),
    22,
  );
  assert.equal(second.success, false);
  assert.match(second.error, /Another setpoint command is running/);
  await ctx.tick(3000);
  assert.equal((await first).success, false);
});

test('credentials refused: a stop persisted, spaced tries, never a loop', async (t) => {
  const ctx = await setup(t, {
    cfg: { broker_url: '192.168.1.50', username: 'gladys', password: 'wrong' },
  });
  const first = ctx.broker.clients[0];
  first.refuse(5);
  await settle();
  assert.equal(first.ended, true);
  assert.deepEqual(ctx.store.data.auth.failures, 1);
  assert.equal(ctx.store.data.auth.until, START + 15 * 60_000);
  assert.doesNotMatch(JSON.stringify(ctx.store.data), /wrong|gladys/);
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /refused the credentials \(not authorized\): next try in 15 min/,
  );
  assert.doesNotMatch(JSON.stringify(ctx.gladys.fake.connectionStatuses), /wrong/);
  await ctx.tick(14 * 60_000);
  assert.equal(ctx.broker.clients.length, 1, 'no try before 15 min');
  await ctx.tick(60_000);
  assert.equal(ctx.broker.clients.length, 2);
  ctx.broker.clients[1].refuse(4);
  await settle();
  assert.equal(ctx.store.data.auth.failures, 2);
  assert.equal(ctx.store.data.auth.until, START + 15 * 60_000 + 60 * 60_000);
});

test('a restart keeps the stop; other credentials lift it', async (t) => {
  const until = START + 60 * 60_000;
  const ctx = await setup(t, {
    cfg: { broker_url: '192.168.1.50', password: 'wrong' },
    memory: { auth: { failures: 2, until } },
  });
  assert.equal(ctx.broker.clients.length, 0, 'no connection during the stop');
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /next try in 60 min/);
  // A reconnection to Gladys does not lift it, and says it again.
  const statuses = ctx.gladys.fake.connectionStatuses.length;
  await ctx.app.gladysConnected({ broker_url: '192.168.1.50', password: 'wrong' });
  assert.equal(ctx.broker.clients.length, 0);
  assert.equal(ctx.gladys.fake.connectionStatuses.length, statuses + 1);
  assert.match(ctx.gladys.fake.connectionStatus.message.fr, /a refusé les identifiants/);
  await ctx.gladys.fake.configUpdated({ broker_url: '192.168.1.50', password: 'right' });
  await settle();
  assert.equal(ctx.broker.clients.length, 1);
  assert.equal(ctx.store.data.auth.failures, 0);
});

test('a stop read back from /data is bounded', async (t) => {
  const ctx = await setup(t, {
    memory: { auth: { failures: 3, until: START + 365 * 24 * 3600_000 } },
  });
  await ctx.tick(24 * 3600_000);
  assert.equal(ctx.broker.clients.length, 1, 'never longer than 24 h');
});

test('a reconnection to Gladys keeps the client and sends the status and the Discovery again', async (t) => {
  const ctx = await setup(t);
  await online(ctx);
  const statuses = ctx.gladys.fake.connectionStatuses.length;
  await ctx.app.gladysConnected(BASE);
  assert.equal(ctx.broker.clients.length, 1);
  assert.equal(ctx.broker.clients[0].ended, false);
  assert.ok(ctx.gladys.fake.connectionStatuses.length > statuses);
  const posts = ctx.gladys.fake.bodies('POST', '/discovered_device').length;
  await ctx.app.gladysConnected(BASE);
  assert.equal(
    ctx.gladys.fake.bodies('POST', '/discovered_device').length,
    posts + 1,
    'the Discovery again',
  );
});

test('a created device never loses a feature', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const device = await create(ctx, '109');
  // The shutter loses its position in a new configuration of the gateway.
  const shutter = { ...OUTPUTS.shutter, properties: {} };
  client.deliver(topic.config, config([controller([shutter])]));
  await ctx.tick(TIMINGS.rebuildDebounce);
  const again = discovered(ctx.gladys, device.external_id);
  assert.deepEqual(
    again.features.map((f) => f.external_id),
    device.features.map((f) => f.external_id),
  );
});

test('the transport badge follows the controller', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const device = await create(ctx, '10');
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
  client.deliver(topic.controller(), {
    id: CTD,
    properties: { connected: false, connectable: true },
  });
  await settle();
  assert.deepEqual(ctx.gladys.fake.transports.at(-1), {
    device_external_id: device.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  const ack = await command(ctx, device, 'power', 1);
  assert.match(ack.error, /contrôleur Qbus n’est pas connecté/);
});

test('a controller that is not connectable is activated once', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  client.deliver(topic.controller(), {
    id: CTD,
    properties: { connected: false, connectable: false },
  });
  client.deliver(topic.controller(), {
    id: CTD,
    properties: { connected: false, connectable: false },
  });
  await settle();
  const activations = client.published.filter((p) => p.topic === `${PREFIX}/${CTD}/setState`);
  assert.equal(activations.length, 1);
  assert.equal(JSON.parse(activations[0].payload).action, 'activate');
});

test('the gateway offline is said, and blocks commands', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  client.deliver(topic.gateway, { id: 'gw', online: false, reason: 'controller lost' });
  await settle();
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /offline \(controller lost\)/);
  const ack = await command(ctx, discovered(ctx.gladys, ID('10')), 'power', 1);
  assert.equal(ack.success, false);
});

test('only the controller of the configured serial number', async (t) => {
  const ctx = await setup(t, { cfg: { broker_url: '192.168.1.50', controller_serial: '999999' } });
  await online(ctx);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 0);
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /no controller with the serial number 999999/,
  );
});

test('hostile messages: too large, wildcards, prototype keys', async (t) => {
  const ctx = await setup(t);
  const client = ctx.broker.clients[0];
  client.open();
  await settle();
  client.deliver(topic.config, 'x'.repeat(3 * 1024 * 1024));
  client.deliver(topic.config, '{"devices": [');
  await ctx.tick(TIMINGS.stateRequestDelay);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 0);
  const evil = [
    { ...OUTPUTS.relay, id: 'UL#' },
    { ...OUTPUTS.relay, id: 'UL/1', refId: `${SERIAL}/11` },
    { ...OUTPUTS.relay, id: 'UL12', refId: 'nope' },
    JSON.parse(
      `{"id":"UL13","refId":"${SERIAL}/13","type":"onoff","name":"ok","__proto__":{"polluted":1}}`,
    ),
  ];
  client.deliver(topic.config, config([controller(evil)]));
  await ctx.tick(TIMINGS.stateRequestDelay);
  assert.deepEqual(
    ctx.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [ID('13')],
  );
  assert.equal({}.polluted, undefined);
  const relay = await create(ctx, '13');
  client.deliver(topic.output('UL13'), '{"properties":{"__proto__":{"value":true}}}');
  client.deliver(topic.output('UL13'), JSON.stringify({ properties: { value: 'yes' } }));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(ctx.gladys.fake.lastState(featureOf(relay, 'power').external_id), undefined);
});

test('the button tests the connection, at most every 10 s', async (t) => {
  const ctx = await setup(t);
  ctx.broker.responder = (t2, payload, client) => {
    if (t2 === TOPICS.getConfig) {
      client.deliver(topic.config, config());
    }
  };
  const pending = ctx.gladys.fake.action(ACTIONS.TEST, {});
  await settle();
  const probe = ctx.broker.clients.at(-1);
  probe.open();
  await settle();
  const ack = await pending;
  assert.equal(ack.success, true, ack.error);
  assert.match(JSON.stringify(ack.data), /1 controller\(s\), 14 output\(s\), 12 device\(s\)/);
  assert.equal(probe.ended, true);
  const again = await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.match(JSON.stringify(again.data), /Already tested/);
});

// --- Round 1 of the review ------------------------------------------------------

const UNSAFE = { broker_url: '192.168.1.50' };
const hiddenFeature = (device, role) => ({
  external_id: `${device.external_id}:${role}`,
  category: 'switch',
  type: 'binary',
});

test('B1: a relay or a dimmer not declared safe is never a switch nor a light', async (t) => {
  const ctx = await setup(t, { cfg: UNSAFE });
  const client = await online(ctx);
  const relay = discovered(ctx.gladys, ID('10'));
  const dimmer = discovered(ctx.gladys, ID('28'));
  assert.deepEqual(
    relay.features.map((f) => [f.external_id.split(':').at(-1), f.category, f.type, f.read_only]),
    [
      ['state', 'unknown', 'binary', true],
      ['turn-on', 'button', 'push', false],
      ['turn-off', 'button', 'push', false],
    ],
  );
  assert.ok(dimmer.features.every((f) => !['light', 'switch'].includes(f.category)));
  for (const device of ctx.gladys.fake.discoveredDevices) {
    if (!['32101'].includes(device.params.find((p) => p.name === 'QBUS_OUTPUT').value)) {
      assert.ok(
        device.features.every((f) => f.category !== 'switch' && f.category !== 'light'),
        device.name,
      );
    }
  }
  // "Turn everything off": the switch does not exist; a command on its id is refused, nothing sent.
  const ack = await ctx.gladys.fake.setValue(relay, hiddenFeature(relay, 'power'), 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas déclarée sûre/);
  // The buttons do nothing unless allowed.
  const press = await command(ctx, relay, 'turn-on', 1);
  assert.match(press.error, /boutons « Allumer » \/ « Éteindre » sont désactivés/);
  assert.equal(client.commands().length, 0);
});

test('B1: the buttons switch the output once allowed', async (t) => {
  const ctx = await setup(t, { cfg: { ...UNSAFE, allow_output_buttons: true } });
  const client = await online(ctx);
  assert.equal((await command(ctx, discovered(ctx.gladys, ID('10')), 'turn-on', 1)).success, true);
  assert.equal((await command(ctx, discovered(ctx.gladys, ID('28')), 'turn-off', 1)).success, true);
  assert.equal(
    (await command(ctx, discovered(ctx.gladys, ID('10')), 'turn-off', 0)).success,
    false,
  );
  assert.deepEqual(
    client.commands().map((c) => c.body),
    [
      { id: 'UL10', type: 'state', properties: { value: true } },
      { id: 'UL15', type: 'action', action: 'off' },
    ],
  );
});

test('B1: a switch created before the output left the safe list is kept, read, refused', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const relay = await create(ctx, '10');
  await ctx.gladys.fake.configUpdated(UNSAFE);
  await ctx.tick(0);
  const again = discovered(ctx.gladys, relay.external_id);
  const roles = again.features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(roles, ['state', 'turn-on', 'turn-off', 'power']);
  client.deliver(topic.output('UL10'), state('UL10', { value: true }));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(ctx.gladys.fake.lastState(featureOf(relay, 'power').external_id), 1);
  const ack = await command(ctx, relay, 'power', 0);
  assert.match(ack.error, /pas déclarée sûre/);
  assert.equal(client.commands().length, 0);
});

test('B1: invalid entries of the safe list are said in the status', async (t) => {
  const ctx = await setup(t, { cfg: { ...UNSAFE, safe_outputs: '10, lamp, 000123:28' } });
  await online(ctx);
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /Ignored in "Outputs declared safe": lamp/,
  );
  assert.equal(featureOf(discovered(ctx.gladys, ID('28')), 'brightness').category, 'light');
});

test('I3: two thermostats set at once by a scene both go through', async (t) => {
  const second = { ...OUTPUTS.thermostat, id: 'UL21', refId: `${SERIAL}/121`, name: 'Bedroom TH' };
  const gw = gateway({ others: { UL21: 20 } });
  const ctx = await setup(t, { cfg: allowed, gw });
  await online(ctx, config([controller([OUTPUTS.thermostat, second])]));
  const a = discovered(ctx.gladys, TH);
  const b = discovered(ctx.gladys, ID('121'));
  const [ackA, ackB] = await Promise.all([
    ctx.gladys.fake.setValue(a, featureOf(a, 'target-temperature'), 17),
    ctx.gladys.fake.setValue(b, featureOf(b, 'target-temperature'), 17),
  ]);
  assert.equal(ackA.success, true, ackA.error);
  assert.equal(ackB.success, true, ackB.error);
  assert.equal(gw.setTemp, 17);
  assert.equal(gw.others.UL21, 17);
});

test('I4: the test button restarts on the configuration saved now', async (t) => {
  const ctx = await setup(t, { cfg: allowed });
  const client = await online(ctx);
  await ctx.gladys.fake.configUpdated({ ...allowed, allow_setpoints: false });
  assert.equal(ctx.app.config.allowSetpoints, false);
  client.refuse(5);
  await settle();
  ctx.broker.responder = (t2, payload, c) => {
    if (t2 === TOPICS.getConfig) {
      c.deliver(topic.config, config());
    }
  };
  const pending = ctx.gladys.fake.action(ACTIONS.TEST, {});
  await settle();
  ctx.broker.clients.at(-1).open();
  await settle();
  assert.equal((await pending).success, true);
  await settle();
  assert.equal(ctx.app.config.allowSetpoints, false, 'the option stays off');
  assert.equal(ctx.store.data.auth.failures, 0);
});

test('M1: a shutter with a position and no state reads closed at 0', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const shutter = await create(ctx, '109');
  client.deliver(topic.output('UL31'), state('UL31', { shutterPosition: 0 }));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(ctx.gladys.fake.lastState(featureOf(shutter, 'shutter').external_id), -1);
  client.deliver(topic.output('UL31'), state('UL31', { shutterPosition: 40 }));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(ctx.gladys.fake.lastState(featureOf(shutter, 'shutter').external_id), 1);
});

test('M2: stop is always sent, "without confirmation" when the shutter declares none', async (t) => {
  const ctx = await setup(t);
  const plain = { ...OUTPUTS.blind, actions: { shutterUp: null, shutterDown: null } };
  const client = await online(ctx, config([controller([plain])]));
  const ack = await command(ctx, discovered(ctx.gladys, ID('108')), 'shutter', 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /envoyée, sans confirmation/);
  assert.deepEqual(client.commands()[0].body.properties, { state: 'stop' });
});

test('M3: a thermostat whose minimum is above the ceiling says so', async (t) => {
  const ctx = await setup(t, { cfg: allowed });
  const warm = {
    ...OUTPUTS.thermostat,
    properties: { ...OUTPUTS.thermostat.properties, setTemp: { type: 'number', min: 26, max: 35 } },
  };
  await online(ctx, config([controller([warm])]));
  const ack = await command(ctx, discovered(ctx.gladys, TH), 'target-temperature', 26);
  assert.match(
    ack.error,
    /minimum of the thermostat \(26 °C\) is above the ceiling of the configuration \(24 °C\)/,
  );
});

test('M6: a state kept by the broker (retain) is not a current state', async (t) => {
  const ctx = await setup(t);
  const client = await online(ctx);
  const relay = await create(ctx, '10');
  client.deliver(topic.output('UL10'), state('UL10', { value: true }), { retain: true });
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(ctx.gladys.fake.lastState(featureOf(relay, 'power').external_id), undefined);
  client.deliver(topic.config, config(), { retain: true });
  await ctx.tick(TIMINGS.rebuildDebounce);
  assert.ok(discovered(ctx.gladys, relay.external_id), 'a retained configuration is kept');
});
