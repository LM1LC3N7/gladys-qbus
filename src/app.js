// -----------------------------------------------------------------------------
// The integration: one connection to the MQTT broker of the user, where the
// Qbus MQTT gateway publishes; the configuration of the gateway (its
// controllers and their outputs) turned into Gladys devices (src/model.js);
// the states the gateway publishes, sent within the Gladys rate limit; the
// commands sent back; the transport badge and the "Test the connection"
// button. index.js only wires the SDK handlers (src/handlers.js).
//
// Failures (lessons of the previous waves):
//   - credentials refused by the broker: the client stops, a stop persisted
//     in /data, next tries 15 min, 1 h, 6 h then every 24 h, never in a loop;
//     saving other credentials or "Test the connection" tries again;
//   - broker unreachable: mqtt.js tries again every 10 s (a local broker);
//   - a CONNECT with credentials closed or left unanswered once the transport
//     opened (TCP connected, or TLS verified: only then has the password
//     left), twice in a row: counted like refused credentials; a transport
//     never opened (firewall, certificate refused) is only "unreachable";
//   - messages are bounded before they are read (src/mqtt.js): MQTT 5 with
//     maximumPacketSize, and a guard on the socket; a broker without MQTT 5
//     is used in 3.1.1, said in the status;
//   - a reconnection to Gladys keeps the MQTT client and the stop, and only
//     re-sends the status, the Discovery and the badges.
//
// Commands:
//   - lights, relays, shutters and scenes are sent at once, nothing queued
//     (a command leaves now or is refused); stop and close are never held;
//   - setpoints (heating) are refused unless the configuration allows them,
//     bounded (5 °C to the ceiling of the configuration, 24 °C by default,
//     never above 30 °C, and the limits of the thermostat), decided on a
//     fresh read of the thermostat and of its controller (never on the
//     values in memory), checked again right before leaving (beforeSend),
//     sent within 3.5 s of the click or refused unsent, confirmed by 4.3 s
//     or answered "sent, without confirmation"; one at a time, never
//     retried; the ack never waits for a publication to Gladys.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ambiguousOutputs, connectionKey, credentialsKey, normalizeConfig } from './config.js';
import { SETPOINT, TIMINGS } from './constants.js';
import { ERRORS, T, TEST, age, word } from './i18n.js';
import { CommandRefusal, buildModel, strictNumber } from './model.js';
import { connectBroker, errorReason, isProtocolRefusal, isRefusal } from './mqtt.js';
import {
  SUBSCRIPTIONS,
  TOPICS,
  activateRequest,
  outputCommand,
  parseConfig,
  parseControllerState,
  parseGatewayState,
  parseOutputState,
  parseTopic,
  stateRequests,
} from './protocol.js';
import { StatePublisher } from './publisher.js';
import { authWait, fileStore, normalizeMemory, serializeMemory } from './store.js';

/** Publishes on the broker, as a promise (mqtt.js uses a callback). Never queued offline. */
const publish = (client, topic, payload) =>
  new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 0, retain: false }, (err) =>
      err ? reject(err) : resolve(),
    );
  });

const near = (a, b) => Math.abs(a - b) < 1e-6;

export class QbusApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'qbus' }),
    connect = connectBroker,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.config = normalizeConfig();
    this.connKey = undefined;
    this.credKey = undefined;
    this.memory = undefined;
    this.client = null;
    this.generation = 0;
    this.started = false;
    /** MQTT 5 first; 3.1.1 once the broker answered CONNACK 1 or 132. */
    this.protocolVersion = 5;
    /** The last connection error, said in the status when the connection ends on it. */
    this.lastError = undefined;
    /** CONNECTs with credentials closed or unanswered in a row (transport opened). */
    this.unanswered = 0;
    this.resetGateway();
    this.model = buildModel({ controllers: [] });
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    /** deviceId -> transport last published */
    this.transports = new Map();
    /** featureId -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    this.timersById = {};
    this.waiters = new Set();
    /** "<controller>/<output>" -> the setpoint command running on that thermostat */
    this.inFlight = new Map();
    /** "<controller>/<output>" -> { expected, until } after a setpoint sent */
    this.guards = new Map();
    this.warned = new Set();
    this.lastTest = 0;
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  resetGateway() {
    /** The configuration of the gateway arrived (since the last connection). */
    this.configReceived = false;
    this.controllers = [];
    this.gateway = { online: undefined, reason: undefined };
    /** controllerId -> { connected, connectable } */
    this.controllerStates = new Map();
    /** "<controller>/<output>" -> Map of the properties last read */
    this.outputStates = new Map();
    this.activated = new Set();
  }

  // --- Memory (/data) ----------------------------------------------------------

  async loadMemory() {
    if (!this.memory) {
      this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    }
    return this.memory;
  }

  async saveMemory() {
    try {
      await this.store.save(serializeMemory(this.memory));
    } catch (err) {
      this.logger.warn(`Saving the state in /data failed: ${err.message}`);
    }
  }

  // --- Timers ------------------------------------------------------------------

  later(name, delay, fn) {
    this.timers.clearTimeout(this.timersById[name]);
    const generation = this.generation;
    this.timersById[name] = this.timers.setTimeout(() => {
      this.timersById[name] = undefined;
      if (generation === this.generation) {
        Promise.resolve()
          .then(fn)
          .catch((err) => this.logger.error(`${name} failed: ${err.message}`));
      }
    }, delay);
  }

  clearTimers() {
    for (const id of Object.values(this.timersById)) {
      this.timers.clearTimeout(id);
    }
    this.timersById = {};
  }

  // --- Lifecycle -----------------------------------------------------------------

  /** Gladys (re)connected: the status, the Discovery and the badges again, the client kept. */
  async gladysConnected(raw) {
    const next = normalizeConfig(raw);
    if (this.started && connectionKey(next) === this.connKey) {
      this.applySoft(next, raw);
      this.lastStatus = undefined;
      this.publishedDevices = undefined;
      this.transports.clear();
      this.refreshCreated();
      // The last status again (connecting, lost, a stop...), then what is known now.
      if (this.lastStatusArgs) {
        await this.setStatus(...this.lastStatusArgs);
      }
      await this.updateStatus();
      await this.rebuild({ force: true });
      return;
    }
    await this.start(raw);
  }

  /** Saved by the user: options apply at once; a new broker or new credentials reconnect. */
  async configUpdated(raw) {
    const next = normalizeConfig(raw);
    if (this.started && connectionKey(next) === this.connKey) {
      const before = this.config;
      this.applySoft(next, raw);
      if (
        before.language !== next.language ||
        [...before.safeOutputs].sort().join() !== [...next.safeOutputs].sort().join()
      ) {
        // Names, or which outputs are switches and lights: the devices are built again.
        await this.rebuild();
      } else {
        await this.updateStatus();
      }
      return;
    }
    await this.start(raw);
  }

  applySoft(next, raw) {
    // The raw configuration too: a later restart (the test button) uses the latest one.
    this.rawConfig = raw ?? {};
    this.config = next;
    this.publisher.configure({
      intervalSeconds: next.sensorInterval,
      throttled: this.model.throttled,
    });
  }

  async start(raw = {}) {
    await this.loadMemory();
    this.stop();
    this.started = true;
    this.rawConfig = raw ?? {};
    this.config = normalizeConfig(raw);
    this.connKey = connectionKey(this.config);
    this.wasConnected = false;
    this.protocolVersion = 5;
    this.lastError = undefined;
    this.unanswered = 0;
    const credentials = credentialsKey(this.config);
    if (
      this.credKey !== undefined &&
      credentials !== this.credKey &&
      this.memory.auth.failures > 0
    ) {
      // Other credentials: the stop on the refused ones is lifted.
      this.memory.auth = { failures: 0, until: 0 };
      await this.saveMemory();
    }
    this.credKey = credentials;
    this.resetGateway();
    this.model = buildModel({ controllers: [] });
    this.publishedDevices = undefined;
    this.lastStatus = undefined;
    this.transports.clear();
    this.lastValues.clear();
    this.refreshCreated();
    if (this.config.problem) {
      await this.setStatus(false, T.problem(this.config.problem));
      return;
    }
    const wait = this.memory.auth.until - this.now();
    if (wait > 0) {
      await this.setStatus(false, T.stopped(age(wait)));
      this.later('auth', wait, () => this.connectNow());
      return;
    }
    await this.connectNow();
  }

  async connectNow() {
    const generation = this.generation;
    await this.setStatus(false, T.connecting);
    if (generation !== this.generation) {
      return;
    }
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    /**
     * A CONNECT left without CONNACK (so far): why, if the attempt ends now.
     * Armed only once the transport opened (TCP connected, or TLS connected
     * AND verified: src/mqtt.js says so), since only then may the
     * credentials have left; cleared by a CONNACK and by every new attempt.
     */
    const UNANSWERED = 'the broker closed the connection without answering';
    let pending;
    let opened = false;
    const hooks = {
      onAttempt: () => {
        pending = undefined;
        opened = false;
      },
      onOpen: () => {
        opened = true;
        pending = UNANSWERED;
      },
    };
    let client;
    try {
      client = this.connect(this.config, { protocolVersion: this.protocolVersion, ...hooks });
    } catch (err) {
      this.lastError = errorReason(err);
      await this.setStatus(false, T.unreachable(this.lastError));
      return;
    }
    this.client = client;
    const current = () => generation === this.generation && this.client === client;
    client.on('packetreceive', (packet) => {
      if (packet?.cmd === 'connack') {
        pending = undefined;
      }
    });
    client.on('connect', () => {
      if (current()) {
        this.unanswered = 0;
        this.lastError = undefined;
        this.onConnect().catch((err) => this.logger.error(`After connection: ${err.message}`));
      }
    });
    client.on('message', (topic, payload, packet) => {
      if (current()) {
        this.onMessage(topic, payload, packet);
      }
    });
    client.on('error', (err) => {
      if (!current()) {
        return;
      }
      let reason = errorReason(err);
      if (err?.message === 'connack timeout' && !opened) {
        // The transport never opened (a firewall dropping the packets...): nothing left.
        reason = 'no answer from the broker at the network level';
      }
      this.lastError = reason;
      if (isRefusal(err)) {
        this.onRefused(reason).catch((e) => this.logger.error(`After a refusal: ${e.message}`));
        return;
      }
      if (isProtocolRefusal(err) && this.protocolVersion === 5) {
        this.onProtocolRefused().catch((e) => this.logger.error(`MQTT 3.1.1: ${e.message}`));
        return;
      }
      if (err?.message === 'connack timeout' && pending) {
        pending = 'no answer from the broker to the connection';
      }
      this.warnOnce(`broker:${reason}`, `MQTT broker: ${reason}`);
      this.setStatus(false, T.unreachable(reason));
    });
    client.on('close', () => {
      if (!current()) {
        return;
      }
      if (pending) {
        const reason = pending;
        pending = undefined;
        this.onUnanswered(reason).catch((e) => this.logger.error(`Unanswered: ${e.message}`));
        return;
      }
      if (this.wasConnected) {
        this.wasConnected = false;
        this.failWaiters();
        // The reason when the connection ended on an error (a message too large...).
        this.setStatus(false, this.lastError ? T.unreachable(this.lastError) : T.lost);
        this.publishAllTransports().catch(() => {});
      }
    });
  }

  /**
   * A CONNECT carrying the credentials was closed or left without answer
   * once the transport was open (a TLS certificate refused or a TCP
   * connection never opened does not count: the password never left): the
   * second time in a row, counted like refused credentials (the next tries
   * are spaced), so the password is not sent every 10 s to a broker that
   * swallows it. Without credentials there is nothing to protect.
   */
  async onUnanswered(reason) {
    this.lastError = reason;
    this.unanswered += 1;
    if (this.hasCredentials() && this.unanswered >= 2) {
      this.unanswered = 0;
      await this.onRefused(`${reason}, twice`);
      return;
    }
    this.warnOnce(`broker:${reason}`, `MQTT broker: ${reason}`);
    await this.setStatus(false, T.unreachable(reason));
  }

  hasCredentials() {
    return Boolean(this.config.username || this.config.password);
  }

  /** The broker does not speak MQTT 5: 3.1.1, with the size guard of src/mqtt.js only. */
  async onProtocolRefused() {
    this.logger.warn('The MQTT broker does not support MQTT 5: using MQTT 3.1.1');
    this.endClient();
    this.protocolVersion = 4;
    await this.connectNow();
  }

  /** The broker refused the credentials: stop, and try again later (persisted). */
  async onRefused(reason) {
    this.logger.warn(`MQTT broker refused the connection: ${reason}`);
    this.endClient();
    this.publisher.stop();
    const failures = this.memory.auth.failures + 1;
    const wait = authWait(failures);
    this.memory.auth = { failures, until: this.now() + wait };
    await this.saveMemory();
    await this.setStatus(false, T.refused(reason, age(wait)));
    this.later('auth', wait, () => this.connectNow());
  }

  endClient() {
    if (this.client) {
      this.client.removeAllListeners?.();
      this.client.on?.('error', () => {});
      this.client.end(true);
      this.client = null;
    }
    this.failWaiters();
  }

  stop() {
    this.generation += 1;
    this.clearTimers();
    this.publisher.stop();
    this.endClient();
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    this.lastStatusArgs = [connected, message];
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (this.warned.size < 200 && !this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  async onConnect() {
    this.logger.info(
      `Connected to the MQTT broker ${this.config.brokerUrl} (MQTT ${this.protocolVersion === 5 ? '5' : '3.1.1'})`,
    );
    this.wasConnected = true;
    if (this.memory.auth.failures > 0) {
      this.memory.auth = { failures: 0, until: 0 };
      await this.saveMemory();
    }
    const client = this.client;
    // A clean session: subscribe again, ask the gateway for everything again.
    client.subscribe(SUBSCRIPTIONS, { qos: 0 }, (err) => {
      if (err) {
        this.logger.warn(`Subscription failed: ${err.message}`);
      }
    });
    this.activated.clear();
    await publish(client, TOPICS.getConfig, '').catch((err) =>
      this.logger.warn(`Asking the gateway for its configuration failed: ${err.message}`),
    );
    if (this.configReceived) {
      this.later('states', TIMINGS.stateRequestDelay, () => this.requestStates());
    }
    await this.updateStatus();
    this.later('config', TIMINGS.configTimeout, () => {
      if (!this.configReceived) {
        return this.setStatus(false, T.noGateway);
      }
      return undefined;
    });
  }

  /** The status from what is known now. */
  async updateStatus() {
    if (this.config.problem) {
      return this.setStatus(false, T.problem(this.config.problem));
    }
    if (!this.client?.connected) {
      return undefined;
    }
    if (this.gateway.online === false) {
      return this.setStatus(false, T.gatewayOffline(this.gateway.reason));
    }
    if (!this.configReceived) {
      return this.setStatus(false, T.waiting);
    }
    if (this.controllers.length === 0) {
      return this.setStatus(false, T.noController(this.config.serial));
    }
    return this.setStatus(
      true,
      T.connected(this.controllers.length, this.model.devices.length, {
        invalid: this.config.invalidOutputs,
        ambiguous: ambiguousOutputs(this.config.safeOutputs, this.controllers.length),
        capped: this.model.capped,
        protocol3: this.protocolVersion !== 5,
      }),
    );
  }

  // --- Messages --------------------------------------------------------------------

  onMessage(topic, payload, packet) {
    const info = parseTopic(topic);
    if (!info) {
      return;
    }
    if (packet?.retain && (info.kind === 'output' || info.kind === 'controller')) {
      // Kept by the broker, maybe from long ago (the gateway stopped since): not a current state.
      return;
    }
    if (info.kind === 'config') {
      this.onConfig(payload);
    } else if (info.kind === 'gateway') {
      this.onGateway(payload);
    } else if (info.kind === 'controller') {
      this.onController(info.controllerId, payload);
    } else {
      this.onOutput(`${info.controllerId}/${info.outputId}`, payload);
    }
  }

  onConfig(payload) {
    const parsed = parseConfig(payload);
    if (parsed.error) {
      this.warnOnce(
        `config:${parsed.error}`,
        `Configuration of the gateway ignored: ${parsed.error}`,
      );
      return;
    }
    if (parsed.dropped > 0) {
      this.warnOnce(
        `dropped:${parsed.dropped}`,
        `${parsed.dropped} controller(s) or output(s) ignored (invalid, duplicated or too many)`,
      );
    }
    const serial = this.config.serial;
    this.controllers = parsed.controllers.filter(
      (c) => serial === undefined || c.serial === serial,
    );
    this.configReceived = true;
    this.later('rebuild', TIMINGS.rebuildDebounce, () => this.rebuild());
    this.later('states', TIMINGS.stateRequestDelay, () => this.requestStates());
  }

  onGateway(payload) {
    const parsed = parseGatewayState(payload);
    if (parsed.error) {
      return;
    }
    const wasOffline = this.gateway.online === false;
    this.gateway = parsed;
    if (wasOffline && parsed.online === true && this.client?.connected) {
      publish(this.client, TOPICS.getConfig, '').catch(() => {});
    }
    this.updateStatus().catch(() => {});
    this.publishAllTransports().catch(() => {});
  }

  onController(controllerId, payload) {
    const controller = this.controllers.find((c) => c.id === controllerId);
    if (!controller) {
      return;
    }
    const parsed = parseControllerState(payload);
    if (parsed.error) {
      return;
    }
    this.controllerStates.set(controllerId, parsed);
    this.notify(`controller:${controllerId}`, { connected: parsed.connected });
    if (
      parsed.connectable === false &&
      !this.activated.has(controllerId) &&
      this.client?.connected
    ) {
      // qbusmqttapi: a controller the gateway may not drive yet is activated once.
      this.activated.add(controllerId);
      this.logger.info(`Activating the Qbus controller ${controller.serial}`);
      const request = activateRequest(controllerId);
      publish(this.client, request.topic, request.payload).catch((err) =>
        this.logger.warn(`Activating the controller failed: ${err.message}`),
      );
    }
    this.publishAllTransports().catch(() => {});
  }

  onOutput(key, payload) {
    const entry = this.model.outputs.get(key);
    if (!entry) {
      return;
    }
    const parsed = parseOutputState(payload);
    if (parsed.error) {
      this.warnOnce(`state:${key}`, `State of ${key} ignored: ${parsed.error}`);
      return;
    }
    const props = this.outputStates.get(key) ?? new Map();
    for (const [name, value] of parsed.properties) {
      props.set(name, value);
    }
    this.outputStates.set(key, props);
    const guard = this.guards.get(key);
    if (
      guard &&
      typeof props.get('setTemp') === 'number' &&
      near(props.get('setTemp'), guard.expected)
    ) {
      this.guards.delete(key);
    }
    this.notify(key, parsed);
    this.recordOutput(entry, props);
  }

  recordOutput(entry, props) {
    for (const featureId of entry.features) {
      const feature = this.model.features.get(featureId);
      const value = feature?.spec.read?.(props);
      if (typeof value === 'number' && Number.isFinite(value)) {
        this.record(featureId, { state: value });
      }
    }
  }

  /** Ask for the states of every controller and output (a little after the configuration). */
  async requestStates() {
    const client = this.client;
    if (!client?.connected) {
      return;
    }
    const ids = [
      ...this.controllers.map((c) => c.id),
      ...[...this.model.outputs.values()].map((e) => e.output.id),
    ];
    for (const request of stateRequests([...new Set(ids)])) {
      await publish(client, request.topic, request.payload).catch((err) =>
        this.logger.warn(`Asking for the states failed: ${err.message}`),
      );
    }
  }

  // --- Devices -----------------------------------------------------------------------

  async rebuild({ force = false } = {}) {
    if (!this.configReceived) {
      return;
    }
    this.model = buildModel({
      externalIds: (type, id) => this.gladys.externalIds(type, id),
      controllers: this.controllers,
      language: this.config.language,
      safeOutputs: this.config.safeOutputs,
    });
    if (this.model.capped > 0) {
      this.warnOnce(
        `capped:${this.model.capped}`,
        `More than 2000 devices: ${this.model.capped} output(s) left out`,
      );
    }
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    const devices = this.keepCreatedFeatures(this.model.devices);
    for (const entry of this.model.outputs.values()) {
      const key = `${entry.output.controller.id}/${entry.output.id}`;
      const props = this.outputStates.get(key);
      if (props) {
        this.recordOutput(entry, props);
      }
    }
    const json = JSON.stringify(devices);
    if (force || json !== this.publishedDevices) {
      this.publishedDevices = json;
      await this.gladys
        .publishDiscoveredDevices(devices)
        .catch((err) => this.logger.warn(`Publishing the devices failed: ${err.message}`));
    }
    await this.updateStatus();
    await this.publishAllTransports();
  }

  /**
   * A device the user created never loses a feature (the core would mark it
   * changed and "Update" would drop the history): the features of the created
   * device that the new build lacks are kept as they are.
   */
  keepCreatedFeatures(devices) {
    const created = new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
    return devices.map((device) => {
      const old = created.get(device.external_id);
      if (!old) {
        return device;
      }
      const ids = new Set(device.features.map((f) => f.external_id));
      const kept = (old.features ?? [])
        .filter((f) => typeof f.external_id === 'string' && !ids.has(f.external_id))
        .map((f) => {
          const copy = {};
          for (const key of [
            'name',
            'external_id',
            'category',
            'type',
            'unit',
            'min',
            'max',
            'read_only',
            'has_feedback',
            'keep_history',
          ]) {
            if (f[key] !== undefined && f[key] !== null) {
              copy[key] = f[key];
            }
          }
          return copy;
        });
      return kept.length === 0 ? device : { ...device, features: [...device.features, ...kept] };
    });
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    await this.publishAllTransports().catch(() => {});
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** Gladys asks for the devices: the configuration again, and the list now. */
  async scan() {
    if (this.client?.connected) {
      await publish(this.client, TOPICS.getConfig, '').catch(() => {});
    }
    await this.rebuild({ force: true });
  }

  // --- Transport badge -------------------------------------------------------------------

  transportOf(deviceId) {
    const output = this.model.deviceOf.get(deviceId);
    const reachable =
      output !== undefined &&
      Boolean(this.client?.connected) &&
      this.gateway.online !== false &&
      this.controllerStates.get(output.controller.id)?.connected !== false;
    return reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
  }

  async publishAllTransports() {
    const entries = [];
    for (const device of this.gladys.devices ?? []) {
      const transport = this.transportOf(device.external_id);
      if (this.transports.get(device.external_id) !== transport) {
        this.transports.set(device.external_id, transport);
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Waiting for an answer of the gateway ------------------------------------------------

  /** Resolves true when a message of `key` matches `predicate`, false at `deadline`. */
  waitFor(key, predicate, deadline, group) {
    let waiter;
    const promise = new Promise((resolve) => {
      waiter = { key, predicate, resolve, group, value: undefined };
      waiter.timer = this.timers.setTimeout(
        () => this.settleWaiter(waiter, false),
        Math.max(0, deadline - this.now()),
      );
    });
    this.waiters.add(waiter);
    return promise;
  }

  settleWaiter(waiter, result) {
    if (this.waiters.delete(waiter)) {
      this.timers.clearTimeout(waiter.timer);
      waiter.resolve(result);
    }
  }

  notify(key, message) {
    for (const waiter of this.waiters) {
      if (waiter.key === key && waiter.predicate(message)) {
        waiter.value = message;
        this.settleWaiter(waiter, message);
      }
    }
  }

  /** Settles the waiters of one command (`group`), or all of them (the connection is gone). */
  failWaiters(group) {
    for (const waiter of [...this.waiters]) {
      if (group === undefined || waiter.group === group) {
        this.settleWaiter(waiter, false);
      }
    }
  }

  // --- Commands --------------------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  /** The gateway can take a command for this output now. */
  checkReachable(output) {
    if (!this.client?.connected) {
      throw this.refusal(ERRORS.notConnected);
    }
    if (this.gateway.online === false) {
      throw this.refusal(ERRORS.gatewayOffline);
    }
    if (this.controllerStates.get(output.controller.id)?.connected === false) {
      throw this.refusal(ERRORS.controllerOffline);
    }
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const entry = this.model.features.get(feature?.external_id);
    if (!entry) {
      throw this.refusal(ERRORS.unknownDevice);
    }
    const { spec, output } = entry;
    if (spec.setpoint) {
      return this.setpoint(output, value, received);
    }
    if (spec.refusal) {
      // A switch or a light kept from before, of an output no longer declared safe.
      throw this.refusal(ERRORS[spec.refusal]);
    }
    if (spec.readOnly || typeof spec.write !== 'function') {
      throw this.refusal(ERRORS.readOnly);
    }
    if (spec.gate === 'outputButtons' && !this.config.allowOutputButtons) {
      throw this.refusal(ERRORS.buttonsDisabled);
    }
    let body;
    try {
      body = spec.write(value);
    } catch (err) {
      if (err instanceof CommandRefusal) {
        throw this.refusal(ERRORS[err.refusal] ?? ERRORS.badValue);
      }
      throw err;
    }
    this.checkReachable(output);
    const request = outputCommand(output, body);
    this.logger.debug(`Qbus ${output.type} ${output.ref}: ${spec.role}`);
    // Lights, relays, shutters, scenes: sent at once. Stop and close are never held behind anything.
    await this.send(request, received + TIMINGS.commandAnswerBy);
    if (body.unconfirmed) {
      throw this.refusal(ERRORS.sentUnconfirmed);
    }
  }

  /** Publishes a command; the ack never waits past `answerBy`. */
  async send(request, answerBy) {
    const client = this.client;
    if (!client?.connected) {
      throw this.refusal(ERRORS.notConnected);
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('late'), Math.max(0, answerBy - this.now()));
    });
    let result;
    try {
      result = await Promise.race([
        publish(client, request.topic, request.payload).then(() => 'sent'),
        late,
      ]);
    } catch (err) {
      // The packet may have been written before the error: never "not sent".
      this.logger.warn(`Command to ${request.topic}: ${errorReason(err)}`);
      result = 'failed';
    } finally {
      this.timers.clearTimeout(timer);
    }
    if (result !== 'sent') {
      throw this.refusal(ERRORS.sentUnconfirmed);
    }
  }

  /** The bounds of a setpoint now: 5 °C .. the ceiling, within the limits of the thermostat. */
  bounds(output) {
    const { min, max } = output.limits.setTemp;
    const low = Math.max(SETPOINT.min, min ?? SETPOINT.min);
    const high = Math.min(this.config.ceiling, max ?? SETPOINT.max);
    return { low, high };
  }

  stepOf(output) {
    const step = output.limits.setTemp.step;
    return step !== undefined && step >= 0.1 && step <= 5 ? step : SETPOINT.stepDefault;
  }

  checkSetpoint(output, wanted) {
    if (!this.config.allowSetpoints) {
      throw this.refusal(ERRORS.setpointsDisabled);
    }
    const { low, high } = this.bounds(output);
    if (low > high) {
      throw this.refusal(ERRORS.ceilingBelowMin(low, this.config.ceiling));
    }
    if (wanted < low || wanted > high) {
      throw this.refusal(ERRORS.outOfRange(low, high));
    }
  }

  async setpoint(output, value, received) {
    if (!this.config.allowSetpoints) {
      throw this.refusal(ERRORS.setpointsDisabled);
    }
    const wanted = strictNumber(value);
    if (wanted === undefined) {
      throw this.refusal(ERRORS.badNumber);
    }
    const step = this.stepOf(output);
    if (Math.abs(wanted / step - Math.round(wanted / step)) > 1e-6) {
      throw this.refusal(ERRORS.badStep(step));
    }
    this.checkSetpoint(output, wanted);
    // One command at a time per thermostat; other thermostats are never held.
    const key = `${output.controller.id}/${output.id}`;
    if (this.inFlight.has(key)) {
      throw this.refusal(ERRORS.stillRunning);
    }
    const promise = this.setpointCommand(output, wanted, received);
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  guardActive(key) {
    const guard = this.guards.get(key);
    return guard !== undefined && guard.until > this.now();
  }

  async setpointCommand(output, wanted, received) {
    const generation = this.generation;
    const client = this.client;
    const key = `${output.controller.id}/${output.id}`;
    const sendBy = received + TIMINGS.commandSendBy;
    const answerBy = received + TIMINGS.commandAnswerBy;
    // The waiters of this command only: another thermostat's are never settled by it.
    const group = Symbol(key);
    /** The checks before sending, on the latest configuration and state. */
    const check = () => {
      this.checkSetpoint(output, wanted);
      if (generation !== this.generation || client !== this.client || !client?.connected) {
        throw this.refusal(ERRORS.notConnected);
      }
      if (this.model.outputs.get(key)?.output.ref !== output.ref) {
        throw this.refusal(ERRORS.unknownDevice);
      }
      if (this.gateway.online === false) {
        throw this.refusal(ERRORS.gatewayOffline);
      }
    };
    check();
    const readBy = Math.min(this.now() + TIMINGS.commandReadMax, sendBy - TIMINGS.commandMinSend);
    if (readBy - this.now() < TIMINGS.commandMinRead) {
      throw this.refusal(ERRORS.tooSlow);
    }
    // The fresh read: the thermostat and its controller now, never the values in memory.
    const controllerRead = this.waitFor(
      `controller:${output.controller.id}`,
      (m) => typeof m.connected === 'boolean',
      readBy,
      group,
    );
    const outputRead = this.waitFor(key, (m) => m.type === 'state', readBy, group);
    try {
      for (const request of [
        ...stateRequests([output.controller.id]),
        ...stateRequests([output.id]),
      ]) {
        await publish(client, request.topic, request.payload);
      }
    } catch (err) {
      this.failWaiters(group);
      throw this.refusal(ERRORS.notSent(errorReason(err)));
    }
    const [controller, fresh] = await Promise.all([controllerRead, outputRead]);
    if (!controller || !fresh) {
      throw this.refusal(ERRORS.tooSlow);
    }
    if (controller.connected !== true) {
      throw this.refusal(ERRORS.controllerOffline);
    }
    const current = fresh.properties.get('setTemp');
    if (typeof current !== 'number') {
      throw this.refusal(ERRORS.missingValue);
    }
    if (near(current, wanted) && !this.guardActive(key)) {
      // Already so: nothing sent.
      return;
    }
    // The option and the ceiling may have changed during the read: checked again.
    check();
    if (this.now() > sendBy) {
      throw this.refusal(ERRORS.tooSlow);
    }
    const request = outputCommand(output, { properties: { setTemp: wanted } });
    // The confirmation is awaited from before the publication (a fast gateway).
    const confirmation = this.waitFor(
      key,
      (m) =>
        typeof m.properties?.get('setTemp') === 'number' &&
        near(m.properties.get('setTemp'), wanted),
      answerBy,
      group,
    );
    // beforeSend: the very last check, right before the message leaves.
    try {
      check();
    } catch (err) {
      this.failWaiters(group);
      throw err;
    }
    this.logger.info(`Qbus setpoint ${output.controller.serial}-${output.ref}: ${wanted} °C`);
    this.guards.set(key, { expected: wanted, until: this.now() + TIMINGS.guard });
    this.later(`followUp:${key}`, TIMINGS.followUp, () => this.requestOne(output));
    await this.send(request, answerBy);
    if (!(await confirmation)) {
      throw this.refusal(ERRORS.sentUnconfirmed);
    }
  }

  async requestOne(output) {
    if (this.client?.connected) {
      for (const request of stateRequests([output.id])) {
        await publish(this.client, request.topic, request.payload).catch(() => {});
      }
    }
  }

  // --- Configuration screen button ---------------------------------------------------------

  /**
   * Connects with the saved configuration (even after refused credentials:
   * the user asked), asks the gateway for its configuration and counts what
   * it has. At most every 10 s.
   */
  async testConnection() {
    // The cooldown first: a burst of clicks never reaches the host API either.
    if (this.now() - this.lastTest < TIMINGS.testCooldown) {
      return TEST.tooSoon;
    }
    this.lastTest = this.now();
    // The saved configuration as it is now (never an older copy: an option turned
    // off since must stay off after the restart below).
    const raw = await this.gladys.getConfig().catch(() => this.rawConfig ?? {});
    const config = normalizeConfig(raw);
    if (config.problem) {
      return T.problem(config.problem);
    }
    const answer = await new Promise((resolve) => {
      let probe;
      let timer;
      let done = false;
      const finish = (result) => {
        if (done) {
          return;
        }
        done = true;
        this.timers.clearTimeout(timer);
        if (probe) {
          probe.removeAllListeners?.();
          probe.on?.('error', () => {});
          probe.end(true);
        }
        resolve(result);
      };
      let protocolVersion = this.protocolVersion;
      const open = () => {
        try {
          probe = this.connect(config, { protocolVersion });
        } catch (err) {
          finish({ text: T.unreachable(errorReason(err)) });
          return;
        }
        probe.on('error', (err) => {
          if (isProtocolRefusal(err) && protocolVersion === 5) {
            // The broker does not speak MQTT 5: once more in 3.1.1.
            protocolVersion = 4;
            probe.removeAllListeners?.();
            probe.on?.('error', () => {});
            probe.end(true);
            open();
            return;
          }
          const reason = errorReason(err);
          finish({
            text: isRefusal(err) ? TEST.refused(reason) : T.unreachable(reason),
            refused: isRefusal(err),
          });
        });
        listen(probe);
      };
      timer = this.timers.setTimeout(
        () => finish({ text: T.unreachable('timeout') }),
        TIMINGS.connectTimeout + 1000,
      );
      const listen = (client) => {
        client.on('message', (topic, payload) => {
          if (parseTopic(topic)?.kind !== 'config') {
            return;
          }
          const parsed = parseConfig(payload);
          if (parsed.error) {
            return;
          }
          const controllers = parsed.controllers.filter(
            (c) => config.serial === undefined || c.serial === config.serial,
          );
          if (controllers.length === 0) {
            finish({ text: T.noController(config.serial), reached: true });
            return;
          }
          const model = buildModel({
            externalIds: (type, id) => this.gladys.externalIds(type, id),
            controllers,
            safeOutputs: config.safeOutputs,
          });
          const outputs = controllers.reduce((n, c) => n + c.outputs.length, 0);
          finish({
            text: TEST.ok(controllers.length, outputs, model.devices.length),
            reached: true,
          });
        });
        client.on('connect', () => {
          this.timers.clearTimeout(timer);
          timer = this.timers.setTimeout(
            () => finish({ text: T.noGateway, reached: true }),
            TIMINGS.testTimeout,
          );
          probe.subscribe([TOPICS.config], { qos: 0 }, () => {
            probe.publish(TOPICS.getConfig, '', { qos: 0, retain: false });
          });
        });
      };
      open();
    });
    if (answer.reached && this.memory?.auth.failures > 0) {
      // The credentials work again: the stop is lifted and the integration reconnects.
      this.memory.auth = { failures: 0, until: 0 };
      await this.saveMemory();
      await this.start(raw);
    }
    return answer.text;
  }
}
