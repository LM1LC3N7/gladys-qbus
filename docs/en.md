# Qbus for Gladys Assistant

This integration brings the outputs of your **Qbus** home automation
controllers (CTD 3.x, the wired home automation of the Belgian manufacturer
Qbus) into Gladys, **over your local network**, through the **Qbus MQTT
gateway** and **your own MQTT broker**. Nothing goes through the Internet.

> This integration has **never been tested with a real Qbus installation**:
> it follows the protocol of qbusmqttapi, the library Qbus wrote for Home
> Assistant. Feedback is welcome on the forum. Unofficial, not affiliated
> with Qbus.

## What you get

| Qbus output               | In Gladys                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Relay (on/off)            | declared safe: a switch; otherwise a read-only state and "Turn on" / "Turn off" buttons             |
| Dimmer (analog)           | declared safe: a light (on/off, brightness); otherwise a read-only state and level, and the buttons |
| Colour light (multicolor) | a light: on/off, brightness, colour                                                                 |
| Shutter, blind            | a shutter: open / close / stop, and its position when the controller reports one                    |
| Thermostat                | the room temperature and the setpoint (setpoint commands **off by default**, see below)             |
| Scene                     | a "Run" push button                                                                                 |
| Gauge                     | a sensor: temperature, humidity, CO2, light, pressure, power, current, voltage, wind                |
| Humidity, ventilation     | humidity sensor, CO2 sensor                                                                         |
| Weather station           | outdoor temperature, light, wind, rain                                                              |

Not in this version: steppers, the regimes (presets) of thermostats and
ventilations, the slats of venetian blinds, the effects of colour lights and
the cumulative gauges (energy, water, volume), the flow gauges (gas, gas flow,
water flow), the water level and loudness gauges (no unit of Gladys for
them). Shutters and thermostats are never switches: a "turn everything off"
of a voice assistant or a scene does not reach them.

## Relays and dimmers: declare the safe ones

A Qbus relay or dimmer may feed anything: a lamp, but also a circulator, the
heat demand of the boiler, an electric heater, a freezer, a sump pump, a
garage door pulse, a 0-10 V valve or ventilation speed. A "turn everything
off / on" of a voice assistant or a scene reaches every switch and every
light. So, by default, a relay or a dimmer is only **shown**, read only, with
"Turn on" / "Turn off" buttons that do nothing until you turn on **Allow the
"Turn on" / "Turn off" buttons**.

List in **Outputs declared safe** the relays and dimmers that may be switched
off or on at any time (lamps): their ref is the parameter QBUS_OUTPUT of the
device in the Discovery tab (`10`, `28`). Refs are numbered per controller:
a plain ref counts only when the gateway has a single controller. With
several, write `serial:ref` (`000123:10`, the serial is the parameter
QBUS_CONTROLLER); a plain ref is then applied nowhere and the status says
so. They then become a switch (relay)
or a light (dimmer). A switch created before an output left the list stays,
shows its state, and refuses commands.

Scenes: a "Run" button starts a scene of the controller as Qbus System
Manager defines it. A Qbus scene may also change heating or open things: the
setpoint option and ceiling of this integration do not apply to it.

## Before you start

1. An MQTT broker on your network (Mosquitto, for example the add-on of your
   NAS, or the broker of the Qbus server).
2. The **Qbus MQTT gateway** (qbusMqttGw), installed and connected to your
   Qbus controller and to this broker, as Qbus explains on
   [iot.qbus.be](https://iot.qbus.be). It publishes under
   `cloudapp/QBUSMQTTGW/...`.
3. In Gladys, install the integration from the store.

## Configuration

- **MQTT broker address**: the IP address of the broker (`192.168.1.20`,
  port 1883), or `mqtts://address:8883` in TLS. TCP or TLS only, no
  WebSocket (the size guard below reads the raw MQTT stream).
- **User name** and **Password**: those of the broker, if it asks for them.
  The password is kept by Gladys in its database, never shown again, and sent
  only to your broker. It never goes into the logs nor into `/data`.
- **Verify the TLS certificate**: on by default; turn it off only for a
  broker with a self-signed certificate on your network.
- **Controller serial number**: empty for every controller of the gateway,
  or the serial of one controller (as Qbus System Manager shows it).
- **Outputs declared safe** and **Allow the "Turn on" / "Turn off"
  buttons**: see above.
- **Allow setpoint commands**: off by default, see below.
- **Setpoint ceiling**: 24 °C by default (16 to 30 °C).
- **Minimum interval between two readings of a measurement**: 10 s by
  default. On/off, positions and setpoints are never delayed.
- **Language of the messages**: French or English.

Then use **Test the connection**: it says how many controllers, outputs and
devices the gateway has. The devices appear in the **Discovery** tab of the
integration: create the ones you want.

## Heating setpoints

The thermostats of Qbus drive the heating. Gladys always shows their
temperature and setpoint. **Changing a setpoint from Gladys** (dashboard,
scenes, voice assistants) is refused until you turn on **Allow setpoint
commands**. When it is on:

- the setpoint stays between 5 °C and the ceiling of the configuration
  (24 °C by default, never above 30 °C), and within the limits the
  controller declares for the thermostat, by steps of 0.5 °C;
- the integration first reads the thermostat and its controller again,
  decides on that fresh read only, and checks the option and the ceiling
  again right before sending;
- the command leaves within 3.5 s of the click or is refused, not sent;
- when the controller does not confirm it in time, Gladys shows "Command
  sent, without confirmation": check the thermostat a moment later.

## Errors and limits

- Never tested with a real device: report on the forum what does not work
  (with the logs of the integration).
- Credentials refused by the broker: the integration stops and tries again
  after 15 min, 1 h, 6 h, then every 24 h (kept across restarts). Saving
  other credentials or **Test the connection** tries at once.
- Broker unreachable, or refusing for another reason (server unavailable,
  identifier rejected): a new try every 10 s.
- Size of the messages: the integration uses MQTT 5 and asks the broker for
  no packet over 2 MB (the configuration of the gateway at most; Mosquitto
  honours it and drops larger messages). A packet over 2 MB that still
  arrives cuts the connection before it is read (a reconnection follows),
  so a huge message kept by the broker can never fill the memory of the
  container. With a broker without MQTT 5, the integration uses MQTT 3.1.1
  and says so in the status: such a message then cuts the connection every
  time it is sent again (remove it from the broker). A state over 64 KB is
  ignored.
- A broker that closes the connection (or stays silent) after receiving the
  credentials, twice in a row, is treated like refused credentials (the next
  tries are spaced). A broker never reached (firewall, TLS certificate
  refused) is only "unreachable", tried again every 10 s: the password
  never left.
- A state kept by the broker (retain) is ignored: only the states the gateway
  sends now count.
- At most 2000 devices (a limit of Gladys): the others are left out and the
  status says so.
- Gateway offline, controller disconnected: the status says it, the devices
  show "unreachable" and commands are refused, never queued.
- Gladys accepts 300 states per minute: measurements are spaced, the rest
  sent first.

## Support

Questions and feedback: the Gladys community forum. Source code and issues:
<https://github.com/LM1LC3N7/gladys-qbus>.
