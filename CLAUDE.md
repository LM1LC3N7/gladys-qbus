# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Qbus home automation
controllers: a Node.js service (Node 22+, ESM, no build step) that runs in its
own sandboxed Docker container, talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the MQTT broker of the user through `mqtt` (mqtt.js), where the Qbus
MQTT gateway publishes. Unofficial, not affiliated with Qbus.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run audit                             # npm audit --omit=dev
node scripts/cover.mjs cover.png          # regenerate the cover
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs `format:check`, `lint` and `test` on Node 22 and 24.

## Architecture

```
index.js           SDK wiring only
src/handlers.js    the SDK handlers -> QbusApp (shared with the tests)
src/app.js         connection, messages, devices, states, commands, test button
src/protocol.js    Qbus topics, parsers, messages (ported from qbusmqttapi)
src/model.js       outputs -> Gladys devices, readers and writers (pure)
src/mqtt.js        mqtt.js client options, error reasons
src/store.js       /data: the stop on refused credentials (never a secret)
src/publisher.js   states within 300 per minute
src/config.js      the manifest config_schema, normalized
src/i18n.js        runtime texts, English and French
```

## Rules

- **External ids are forever**: `ext:<selector>:output:<serial>-<ref>`,
  features `<device>:<role>` (src/constants.js FEATURES). Never change one.
- **Never a switch** for a shutter or a thermostat. Setpoints stay refused
  unless `allow_setpoints` is on, bounded (5 °C to the ceiling, 30 °C at
  most), decided on a fresh read, checked again right before sending.
- **Nothing queued** while the broker is down (`queueQoSZero: false`).
- **Never a secret** in the logs, `/data`, a status or an error. The
  password is "kept by Gladys in its database, never shown again" (Gladys
  stores it in clear: never claim more, `test/manifest.test.js` checks it).
- **Untrusted input**: everything from the broker is bounded and
  type-checked; ids are checked before they go into a topic; only own keys.
- **Versions** belong to the Release workflow; **changelog** lines go under
  `## [Unreleased]`.
- **Texts** are bilingual (English and French), UTF-8 without BOM
  (`test/encoding.test.js`). Tests never touch the network.
