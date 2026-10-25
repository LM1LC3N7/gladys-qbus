# TODO

## Status

Milestone 1 (0.1.0, local commits, not pushed; review 1 fixed): the outputs of the Qbus
controllers read and controlled through the Qbus MQTT gateway and the broker
of the user; setpoints behind an off-by-default option, bounded. Never tested
with a real Qbus installation nor a real gateway. The store validator
(`npx github:GladysAssistant/integration-store .`) could not be run from the
development agent: run it before publishing. No end-to-end test in a
container (no Docker on the development PC).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-qbus:0.1.0`):
  the first patch release gives 0.1.1.
- **Reference**: qbusmqttapi 1.5.1 (MIT, Qbus, the manufacturer), read at
  commit 376503c, license checked in its `LICENSE` (MIT, "Copyright (c) 2025
  Qbus"); the mapping of the outputs from Home Assistant's Qbus integration
  (Apache-2.0, `homeassistant/components/qbus`, commit 1d6681b). Ported, not
  copied; credited in `THIRD_PARTY_NOTICES.md`, shipped in the image.
- **Neighbours**: gladys-victron (local MQTT: client, publisher, fake
  broker) and gladys-homee (shutters, push buttons); the command rules of
  gladys-touchline-sl (heating setpoints). Read only, nothing changed in them.
- **MQTT of the user only**: the integration connects to the broker the user
  types (the Qbus MQTT gateway publishes there); it never talks to the Qbus
  cloud nor to the controller directly. `queueQoSZero: false`: nothing is
  queued while offline, so a command never leaves minutes later.
- **External ids**: `ext:<selector>:output:<controller serial>-<ref>`, the
  ref being the number Qbus System Manager gives the output ("000001/10" ->
  "10", "000001/105/3" -> "105-3"), as Home Assistant keys its entities. An
  output without a readable ref is not offered (no stable id). The output id
  of the gateway ("UL10") is only used for the topics.
- **Relays and dimmers: switches and lights only when declared safe**
  (review 1, B1 and I5; Louis's rule, models gladys-blebox and gladys-homee).
  A Qbus onoff or analog output may drive a circulator, the boiler demand, a
  heater, a freezer, a garage door pulse or a 0-10 V valve, and "turn
  everything off / on" reaches every switch and light. Only the outputs of
  "Outputs declared safe" (`safe_outputs`: `<ref>` or `<serial>:<ref>`, a
  plain `<ref>` counting only when the gateway has a single controller after
  the `controller_serial` filter, otherwise applied nowhere and named in the
  status as ambiguous (review 2, R1: refs are numbered per controller), 500
  entries at most, invalid ones said in the status) become `switch/binary`
  (relay) or `light/binary` + `light/brightness` (dimmer), role `power` (and
  `brightness`). The others are `unknown/binary` read only (role `state`),
  `unknown/unknown` 0–100 for a dimmer (role `level`), and `button/push`
  "Turn on" / "Turn off" (roles `turn-on`, `turn-off`), refused unless
  `allow_output_buttons` (off by default), like `allow_plug_control` of
  homee. Both sets are built, the other one hidden: a feature created before
  the list changed is kept (never a lost feature), keeps its state, and a
  command on a hidden switch or light is refused ("not declared safe").
  Colour lights (multicolor) stay lights: LED drivers.
- **Message size** (lot 15, lesson of gladys-pglab r1): MQTT 5 with
  `maximumPacketSize: LIMITS.packetBytes` (2 MB + 8 KB: the configuration
  of the gateway, 8 controllers x 1000 outputs at ~250 bytes, plus topic and
  headers; Mosquitto 2.0.20 drops a larger message instead of sending it),
  and a guard on the raw socket (`src/mqtt.js` `PacketGuard`): a packet
  header announcing more than that cuts the connection before the body is
  buffered (tested with a fake broker pushing a 200 MB PUBLISH, and for
  real with Mosquitto 2.0.20 and a 120 MB retained message in a 256 MB
  container). Hence TCP and TLS only, no WebSocket (the Qbus gateway itself
  publishes over TCP; the guard reads the raw MQTT stream). A broker
  answering CONNACK 1 or 132 (no MQTT 5) is used in 3.1.1, said in the
  status: the guard still applies, but a huge retained message then cuts
  every connection. A CONNECT with credentials closed or unanswered once the
  transport opened, twice in a row, counts like a refusal (spaced tries);
  never before the transport opened (pglab r2, N1).
- **CONNACK refusals** (review 1, I1): `reconnectOnConnackError: true`, so 1-3
  (protocol, identifier, server unavailable) are tried again every 10 s like
  an unreachable broker; 4, 5, 134, 135 end the client (no mqtt.js
  reconnection after `end()`) and the persisted stop spaces the next tries.
  Tested against a real mqtt.js and a local fake broker (`test/connack.test.js`).
- **Gauges min/max** (I2): the `currentValue` min/max of the configuration
  when finite and ordered, else a range per variant; every published
  feature has a finite min <= max (tested).
- **One setpoint at a time per thermostat** (I3), the waiters of a command
  settled by that command only.
- **The test button reads the saved configuration** (`getConfig`) before
  its restart (I4); `rawConfig` also follows every soft update.
- **Shutter state** from the position when the controller gives no `state`
  (0 closed, otherwise open, as Home Assistant's `is_closed`) (M1). A stop is
  always sent; on a shutter without `shutterStop` it is answered "sent,
  without confirmation" (M2).
- **2000 devices at most** in the Discovery (the core's
  MAX_DISCOVERED_DEVICES), the rest left out with a warning and the status
  (M4).
- **Packet size** (M5): documented, not enforced at the MQTT level (MQTT 5
  `maximumPacketSize` would exclude older brokers); the 2 MB / 64 KB bounds
  apply after mqtt.js received the packet.
- **Retained states ignored** for outputs and controllers (M6): a state kept
  by the broker may be old; the configuration and the gateway state are kept.
- **Scenes** may raise the heating or open things on the Qbus side: the
  setpoint option does not apply to them (documented, M7).
- **Shutters and thermostats never switches**: `shutter/state` and
  `shutter/position`; `temperature-sensor` and `thermostat/target-temperature`.
  The shutter state comes from the Qbus `state` (up/down/stop) only; a
  shutter with a position opens to 100 and closes to 0 (and its slats to 0),
  as Home Assistant does. Stop and close are never held behind anything.
- **Setpoints**: the option `allow_setpoints` (off by default) is checked on
  arrival, after the fresh read and right before the publication. Bounds:
  5 °C to the ceiling (24 °C by default, 16–30 °C, never above 30 °C),
  within the min/max the controller declares for the thermostat, by its
  step (0.5 °C by default). The fresh read asks the gateway for the state of
  the controller (`connected` must be true) and of the thermostat (a full
  `state`, not an `event`) after the click; the cached values never decide.
  A setpoint equal to the fresh one is not sent (unless a previous command
  of the same thermostat is still unconfirmed: a 90 s guard).
- **No protective setpoint**: a Qbus thermostat has no "off" command; the
  regimes (MANUEEL, VORST/frost, ECONOMY, COMFORT, NACHT) are not offered in
  v1, so no frost-protection shortcut either.
- **Activation**: a controller that reports `connectable: false` is
  activated once per connection with the fixed key of the Qbus protocol, as
  qbusmqttapi does (not a secret of the user, never logged).
- **Credentials refused** (CONNACK 4, 5, 134, 135): the client is ended (no
  mqtt.js reconnection loop), the stop persisted in `/data/qbus-state.json`
  (failures and end only), next tries 15 min, 1 h, 6 h, 24 h; other
  credentials or the test button lift it. An unreachable broker is left to
  mqtt.js (every 10 s: a local broker).
- **Reconnection to Gladys** keeps the MQTT client and the stop, empties the
  caches of the status, the Discovery and the badges, and sends them again.
- **Measurements throttled** by `sensor_interval` (10 s by default); on/off,
  positions, setpoints and rain never.
- **Gauges not offered**: the cumulative ENERGY, WATER and VOLUME (an index
  needs the approved guard of gladys-p1-monitor; units never seen on a real
  installation); the flows GAS, GASFLOW and WATERFLOW (m³/h, l/h: no unit of
  the core), WATERLEVEL and LOUDNESS (no matching category and unit).

## Next

- Thermostat regimes as `thermostat/preset` (FROST, ECO, NIGHT, COMFORT),
  behind the same option, the regime that raises the heating bounded.
- Slats of venetian blinds; effects of colour lights; steppers as a select.
- Energy and water gauges as indexes, with the guard of gladys-p1-monitor.
- Test with a real gateway (Belgian user of the forum, topic 8672).
