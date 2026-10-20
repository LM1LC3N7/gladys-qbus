# gladys-qbus

[Gladys Assistant](https://gladysassistant.com) external integration for
**Qbus** home automation controllers (CTD 3.x), over the **local MQTT broker
of the user**, where the Qbus MQTT gateway (qbusMqttGw) publishes: relays,
dimmers, colour lights, shutters and blinds, thermostats, scenes and sensors
(gauges, humidity, CO2, weather station). Shutters and thermostats are never
switches; heating setpoints are refused unless allowed, and bounded (5 °C to
a ceiling of 24 °C by default, 30 °C at most). **Never tested with a real
installation. Unofficial, not affiliated with Qbus.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (QbusApp)
                                  ├─ src/mqtt.js       mqtt.js client, nothing queued offline
                                  ├─ src/protocol.js   Qbus topics, parsers, messages (qbusmqttapi)
                                  ├─ src/model.js      outputs -> Gladys devices (pure)
                                  ├─ src/store.js      /data: the stop on refused credentials (no secret)
                                  └─ src/publisher.js  states within 300/min
```

- **Reads**: subscribes to `cloudapp/QBUSMQTTGW/config`, `/state`,
  `/+/state` and `/+/+/state`; publishes `getConfig` on every connection,
  then `getState` for the controllers and outputs (3 s later, by 100 ids).
  The configuration is read up to 2 MB (8 controllers, 1000 outputs each),
  a state up to 64 KB; ids are checked before they go into a topic, only
  own keys are read, every value is type-checked.
- **Devices**: `ext:<selector>:output:<controller serial>-<ref>` (the ref of
  Qbus System Manager, as Home Assistant keys its entities); features
  `<device>:<role>`; a created device never loses a feature.
- **Commands**: lights, relays, shutters and scenes sent at once, never
  queued while the broker is down. Setpoints (`allow_setpoints`, off by
  default): a fresh read of the thermostat and of its controller decides;
  the option and the ceiling are checked on arrival, after the read and
  right before the message leaves; sent within 3.5 s or refused unsent;
  "sent, without confirmation" when the controller does not confirm by
  4.3 s; one at a time.
- **Failures**: credentials refused by the broker stop the client, a stop
  persisted in `/data`, next tries 15 min, 1 h, 6 h, 24 h, never a loop; an
  unreachable broker is tried every 10 s; a reconnection to Gladys keeps the
  client and re-sends the status, the Discovery and the badges.

## Credits

The Qbus MQTT protocol is ported from
[qbusmqttapi](https://github.com/Qbus-iot/qbusmqttapi) (Qbus, MIT, 1.5.1),
the library of Home Assistant's Qbus integration, and the mapping of the
outputs from that integration
([home-assistant/core](https://github.com/home-assistant/core/tree/dev/homeassistant/components/qbus),
Apache-2.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled
on the sibling integrations
[gladys-victron](https://github.com/LM1LC3N7/gladys-victron) (local MQTT)
and [gladys-touchline-sl](https://github.com/LM1LC3N7/gladys-touchline-sl)
(heating setpoints behind an option).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
node scripts/cover.mjs cover.png                # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the broker and the Qbus gateway are a fake
mqtt.js client (`test/helpers/fakeMqtt.js`), Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags,
builds the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from MIT and Apache-2.0
projects, credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also
shipped in the Docker image).
