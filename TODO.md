# TODO

## Status

Milestone 1 (0.1.0, local commit, not pushed): the outputs of the Qbus
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
- **Relays are switches** (`switch/binary`), as Home Assistant maps them:
  they mostly drive lights and sockets. A relay that drives a pump or a
  heater should be left out of "turn everything off" scenes by the user
  (documented). To revisit if users ask for a read-only mode per output.
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
- **Cumulative gauges not offered** (ENERGY, WATER, GAS, VOLUME): an energy
  index needs the approved guard of gladys-p1-monitor and the units of the
  Qbus gauges (Wh, m³) were never seen on a real installation.

## Next

- Thermostat regimes as `thermostat/preset` (FROST, ECO, NIGHT, COMFORT),
  behind the same option, the regime that raises the heating bounded.
- Slats of venetian blinds; effects of colour lights; steppers as a select.
- Energy and water gauges as indexes, with the guard of gladys-p1-monitor.
- A read-only mode per relay (pumps, heaters), if asked.
- Test with a real gateway (Belgian user of the forum, topic 8672).
