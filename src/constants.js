// -----------------------------------------------------------------------------
// Constants: the Qbus MQTT protocol, feature roles, manifest keys, limits and
// timings.
//
// A Qbus controller (CTD 3.x) does not speak MQTT itself: the Qbus MQTT
// gateway (qbusMqttGw, on the Qbus server or a Raspberry Pi) bridges it to an
// MQTT broker of the user (Mosquitto...). Every topic starts with
// cloudapp/QBUSMQTTGW, as in qbusmqttapi 1.5.1 (MIT, Qbus, the library of
// Home Assistant's Qbus integration).
// -----------------------------------------------------------------------------

export const TOPIC_PREFIX = 'cloudapp/QBUSMQTTGW';

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  /** On/off of a relay, a dimmer or a colour light. */
  POWER: 'power',
  BRIGHTNESS: 'brightness',
  COLOR: 'color',
  /** Shutter: open / close / stop, and its position. */
  SHUTTER: 'shutter',
  POSITION: 'position',
  /** Thermostat: the room temperature and the setpoint. */
  TEMPERATURE: 'temperature',
  TARGET: 'target-temperature',
  /** A scene of the controller: a push button. */
  SCENE: 'run',
  /** The value of a gauge, a humidity sensor, the CO2 of a ventilation. */
  VALUE: 'value',
  CO2: 'co2',
  /** Weather station. */
  WEATHER_TEMPERATURE: 'weather-temperature',
  WEATHER_LIGHT: 'weather-light',
  WEATHER_WIND: 'weather-wind',
  WEATHER_RAIN: 'weather-rain',
};

/** Manifest `actions` keys: frozen. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** The minimum interval between two readings of a measurement (s), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

/**
 * The setpoints Gladys may send, in °C. A heated room stays within 5–30 °C
 * whatever is typed; the configuration lowers the ceiling (24 °C by default,
 * 16 to 30 °C), and the limits the controller declares for the thermostat
 * (its min, max and step) apply too.
 */
export const SETPOINT = {
  min: 5,
  max: 30,
  ceilingMin: 16,
  ceilingDefault: 24,
  stepDefault: 0.5,
};

/** Gladys COVER_STATE (server/utils/constants.js). */
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

/** Gladys value of a pressed push button. */
export const PRESSED = 1;

export const LIMITS = {
  /** Gladys accepts 300 states per minute: a margin is kept. */
  statesPerMinute: 250,
  /** A state message of an output: a few hundred bytes. Larger is dropped. */
  stateBytes: 64 * 1024,
  /** The configuration of the gateway (every output of every controller). */
  configBytes: 2 * 1024 * 1024,
  /** What one gateway may hold: more is ignored. */
  controllers: 8,
  outputsPerController: 1000,
  /** Names are cut to this length. */
  nameLength: 60,
  /** Output ids sent in one getState request. */
  idsPerRequest: 100,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** Broker connection timeout. */
  connectTimeout: 10 * SECOND,
  /** Delay between two reconnection attempts when the broker is unreachable. */
  reconnectPeriod: 10 * SECOND,
  /** How long to wait for the gateway to send its configuration before saying so. */
  configTimeout: 15 * SECOND,
  /** The states are asked a little after the configuration (Home Assistant: 3 s). */
  stateRequestDelay: 3 * SECOND,
  /** Several configurations in a row (a gateway restart): rebuild once. */
  rebuildDebounce: 1500,
  /** The pending states are sent at this pace. */
  flushInterval: SECOND,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * MINUTE,
  /** How long the "Test the connection" button waits for the gateway. */
  testTimeout: 20 * SECOND,
  /** The button reads at most this often. */
  testCooldown: 10 * SECOND,
  /** Credentials refused by the broker: next tries 15 min, 1 h, 6 h, then every 24 h. */
  authRetry: [15 * MINUTE, HOUR, 6 * HOUR, 24 * HOUR],
  /**
   * Setpoint commands (Gladys waits 5 s for the ack): the fresh read of the
   * thermostat and the write must leave by 3.5 s after the click, or the
   * command is refused unsent; its confirmation is awaited until 4.3 s,
   * after which the command is "sent, without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** The fresh read of a command: 2.5 s at most, and 0.3 s left to send after it. */
  commandReadMax: 2_500,
  commandMinRead: 300,
  commandMinSend: 300,
  /** A read of the thermostat after a setpoint command. */
  followUp: 2 * SECOND,
  /** A sent setpoint keeps its guard until a read shows it, or 90 s. */
  guard: 90 * SECOND,
};
