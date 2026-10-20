# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the projects below. The ported parts
were rewritten, not copied; the changes are described below.

## qbusmqttapi

<https://github.com/Qbus-iot/qbusmqttapi> (package `qbusmqttapi`, by Qbus, the
manufacturer, the library of Home Assistant's Qbus integration), version
1.5.1 of 2026-06-13, read at commit 376503c. MIT License (`LICENSE` of the
repository). Ported: the topics of the Qbus MQTT gateway, the parsing of its
configuration and of the states of the controllers and outputs, the messages
sent (state requests, the activation of a controller, the commands of the
outputs). Changed: every value received is type-checked and bounded, ids are
checked before they go into a topic, only the properties this integration
uses are kept.

```
MIT License

Copyright (c) 2025 Qbus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Home Assistant, Qbus integration

<https://github.com/home-assistant/core/tree/dev/homeassistant/components/qbus>
(Home Assistant core, `homeassistant/components/qbus`, by Qbus and thomasddn),
read on the `dev` branch at commit 1d6681b (2026-10-20). Apache License 2.0
(`LICENSE.md` of the repository), the same text as
the `LICENSE` file of this integration. Ported: which Qbus output type
becomes which kind of device (light, switch, cover, climate, scene, sensors),
the format of the output ref ids used in the identifiers, the order of the
requests after the configuration, the scale of the light of the weather
station. Changed: Gladys devices instead of Home Assistant entities;
setpoints refused unless allowed and bounded; shutters never switches.
Home Assistant core has no `NOTICE` file.

```
Copyright Home Assistant contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## mqtt.js

The runtime dependency `mqtt` (<https://github.com/mqttjs/MQTT.js>, MIT
License) is installed from npm in the image with its own license file.
