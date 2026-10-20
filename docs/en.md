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

| Qbus output               | In Gladys                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Relay (on/off)            | a switch                                                                                |
| Dimmer (analog)           | a light: on/off, brightness                                                             |
| Colour light (multicolor) | a light: on/off, brightness, colour                                                     |
| Shutter, blind            | a shutter: open / close / stop, and its position when the controller reports one        |
| Thermostat                | the room temperature and the setpoint (setpoint commands **off by default**, see below) |
| Scene                     | a "Run" push button                                                                     |
| Gauge                     | a sensor: temperature, humidity, CO2, light, pressure, power, current, voltage, wind    |
| Humidity, ventilation     | humidity sensor, CO2 sensor                                                             |
| Weather station           | outdoor temperature, light, wind, rain                                                  |

Not in this version: steppers, the regimes (presets) of thermostats and
ventilations, the slats of venetian blinds, the effects of colour lights and
the cumulative gauges (energy, water, gas). Shutters and thermostats are
never switches: a "turn everything off" of a voice assistant or a scene does
not reach them.

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
  port 1883), or `mqtts://address:8883` in TLS.
- **User name** and **Password**: those of the broker, if it asks for them.
  The password is kept by Gladys in its database, never shown again, and sent
  only to your broker. It never goes into the logs nor into `/data`.
- **Verify the TLS certificate**: on by default; turn it off only for a
  broker with a self-signed certificate on your network.
- **Controller serial number**: empty for every controller of the gateway,
  or the serial of one controller (as Qbus System Manager shows it).
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
- Broker unreachable: a new try every 10 s.
- Gateway offline, controller disconnected: the status says it, the devices
  show "unreachable" and commands are refused, never queued.
- Gladys accepts 300 states per minute: measurements are spaced, the rest
  sent first.

## Support

Questions and feedback: the Gladys community forum. Source code and issues:
<https://github.com/LM1LC3N7/gladys-qbus>.
