# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Qbus controllers (CTD 3.x) through the Qbus MQTT gateway and the local MQTT
  broker of the user: relays and dimmers (a switch or a light only when declared
  safe, otherwise a read-only state with "Turn on" / "Turn off" buttons behind
  an option off by default), colour lights (light),
  shutters and blinds (open, close, stop, position), thermostats (room
  temperature and setpoint), scenes (push button), gauges (temperature,
  humidity, CO2, light, pressure, power, current, voltage, wind), humidity
  and ventilation sensors, weather station (temperature, light, wind, rain).
- Setpoint commands behind an option, off by default; setpoints from 5 °C to
  a ceiling of 24 °C by default (16 to 30 °C, never above 30 °C), within the
  limits of the thermostat. Decided on a fresh read of the thermostat and of
  its controller, sent within 3.5 s or refused unsent, "sent, without
  confirmation" when the controller stays silent.
- Shutters and thermostats are never switches.
- "Outputs declared safe": a ref without a serial counts only with a single
  controller; with several, `serial:ref` is needed (a plain ref is applied
  nowhere and named in the status).
- One setpoint command at a time per thermostat; retained states ignored;
  2000 devices at most; CONNACK refusals other than credentials tried again.
- Credentials refused by the broker: a stop kept in `/data` (no secret
  there), next tries 15 min, 1 h, 6 h, then every 24 h.
- Transport badge per device (gateway offline, controller disconnected), a
  "Test the connection" button, messages in French or English.
