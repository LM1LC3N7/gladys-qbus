# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.3] - 2026-10-25

### Fixed

- The size of the MQTT packets is bounded before they are read: MQTT 5 with
  `maximumPacketSize` (2 MB, the configuration of the gateway at most;
  Mosquitto drops larger messages instead of sending them) and a guard on
  the socket that cuts a packet announced over 2 MB before buffering it.
  A huge message kept by the broker on a followed topic (120 MB) used to be
  read in full on every start and kill the container (out of memory) before
  any command could leave. A broker without MQTT 5 is used in MQTT 3.1.1,
  said in the status. TCP and TLS only: WebSocket URLs are refused.
- A CONNECT with credentials closed or left unanswered by the broker counts
  towards the spaced tries only once the transport opened (TCP connected, or
  TLS verified): a firewall dropping the packets or a certificate refused is
  only "unreachable", tried again every 10 s, the password never having left.

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-21

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-qbus/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/LM1LC3N7/gladys-qbus/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-qbus/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-qbus/releases/tag/v0.1.1
