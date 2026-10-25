// -----------------------------------------------------------------------------
// Runtime texts (English and French): feature names, the status of the
// integration, the answers of the button and the command errors. None of
// them ever carries the password of the broker.
// -----------------------------------------------------------------------------

import { FEATURES as F, LIMITS } from './constants.js';

const MAX_PACKET_MB = Math.round(LIMITS.packetBytes / (1024 * 1024));

const both = (en, fr) => ({ en, fr });

/** One language of a `{ en, fr }` text. */
export const word = (value, language) => (language === 'en' ? value.en : value.fr);

/** "45 s", "5 min", "2 h". */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 90) {
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

const FEATURE_NAMES = {
  [F.POWER]: both('On/off', 'Marche/arrêt'),
  [F.BRIGHTNESS]: both('Brightness', 'Luminosité'),
  [F.STATE]: both('State', 'État'),
  [F.LEVEL]: both('Level', 'Niveau'),
  [F.TURN_ON]: both('Turn on', 'Allumer'),
  [F.TURN_OFF]: both('Turn off', 'Éteindre'),
  [F.COLOR]: both('Colour', 'Couleur'),
  [F.SHUTTER]: both('Open / close', 'Ouvrir / fermer'),
  [F.POSITION]: both('Position', 'Position'),
  [F.TEMPERATURE]: both('Temperature', 'Température'),
  [F.TARGET]: both('Setpoint', 'Consigne'),
  [F.SCENE]: both('Run', 'Lancer'),
  [F.VALUE]: both('Value', 'Valeur'),
  [F.CO2]: both('CO2', 'CO2'),
  [F.WEATHER_TEMPERATURE]: both('Outdoor temperature', 'Température extérieure'),
  [F.WEATHER_LIGHT]: both('Light', 'Luminosité extérieure'),
  [F.WEATHER_WIND]: both('Wind', 'Vent'),
  [F.WEATHER_RAIN]: both('Rain', 'Pluie'),
};

export const featureName = (role, language) =>
  word(FEATURE_NAMES[role] ?? both(role, role), language);

const BROKER_PROBLEMS = {
  empty: both('the address of the MQTT broker is empty', 'l’adresse du broker MQTT est vide'),
  invalid: both(
    'the address of the MQTT broker is not valid',
    'l’adresse du broker MQTT n’est pas valide',
  ),
  credentials: both(
    'type the user name and the password in their own fields, not in the address',
    'saisissez l’utilisateur et le mot de passe dans leurs champs, pas dans l’adresse',
  ),
};

/** The connection status (shown in the Configuration screen). */
export const T = {
  problem: (problem) => {
    if (problem === 'broker:empty') {
      return both(
        'Not configured: type the address of your MQTT broker (the one the Qbus MQTT gateway publishes to).',
        'Non configuré : saisissez l’adresse de votre broker MQTT (celui où publie la passerelle MQTT Qbus).',
      );
    }
    if (problem?.startsWith('broker:')) {
      const p = BROKER_PROBLEMS[problem.slice(7)] ?? BROKER_PROBLEMS.invalid;
      return both(`Configuration: ${p.en}.`, `Configuration : ${p.fr}.`);
    }
    if (problem === 'serial') {
      return both(
        'Configuration: the serial number of the controller is not valid (digits, as in Qbus System Manager).',
        'Configuration : le numéro de série du contrôleur n’est pas valide (des chiffres, comme dans Qbus System Manager).',
      );
    }
    return both(
      'Configuration: the password is too long.',
      'Configuration : le mot de passe est trop long.',
    );
  },
  connecting: both('Connecting to the MQTT broker…', 'Connexion au broker MQTT…'),
  waiting: both(
    'Connected to the broker: waiting for the Qbus MQTT gateway…',
    'Connecté au broker : en attente de la passerelle MQTT Qbus…',
  ),
  noGateway: both(
    'Connected to the broker, but no Qbus MQTT gateway answered: check that qbusMqttGw runs and publishes to this broker.',
    'Connecté au broker, mais aucune passerelle MQTT Qbus n’a répondu : vérifiez que qbusMqttGw tourne et publie sur ce broker.',
  ),
  gatewayOffline: (reason) =>
    both(
      `The Qbus MQTT gateway is offline${reason ? ` (${reason})` : ''}.`,
      `La passerelle MQTT Qbus est hors ligne${reason ? ` (${reason})` : ''}.`,
    ),
  noController: (serial) =>
    serial
      ? both(
          `The gateway answered, but has no controller with the serial number ${serial}.`,
          `La passerelle a répondu, mais n’a aucun contrôleur de numéro de série ${serial}.`,
        )
      : both(
          'The gateway answered, but lists no controller.',
          'La passerelle a répondu, mais ne liste aucun contrôleur.',
        ),
  connected: (
    controllers,
    devices,
    { invalid = [], ambiguous = [], capped = 0, protocol3 = false } = {},
  ) =>
    both(
      [
        `Connected: ${controllers} controller(s), ${devices} device(s) offered in the Discovery tab.`,
        invalid.length > 0
          ? `Ignored in "Outputs declared safe": ${invalid.join(', ')} (expected a ref such as 10, or serial:ref).`
          : '',
        ambiguous.length > 0
          ? `Not applied in "Outputs declared safe": ${ambiguous.slice(0, 10).join(', ')} (ambiguous with several controllers: use serial:ref).`
          : '',
        capped > 0 ? `${capped} output(s) left out: Gladys takes 2000 devices at most.` : '',
        protocol3
          ? `The broker does not support MQTT 5: it does not limit the size of the messages it sends; a message over ${MAX_PACKET_MB} MB cuts the connection.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      [
        `Connecté : ${controllers} contrôleur(s), ${devices} appareil(s) proposé(s) dans l’onglet Découverte.`,
        invalid.length > 0
          ? `Ignoré dans « Sorties déclarées sûres » : ${invalid.join(', ')} (attendu : une référence comme 10, ou série:référence).`
          : '',
        ambiguous.length > 0
          ? `Non appliqué dans « Sorties déclarées sûres » : ${ambiguous.slice(0, 10).join(', ')} (ambigu avec plusieurs contrôleurs : utilisez série:référence).`
          : '',
        capped > 0
          ? `${capped} sortie(s) laissée(s) de côté : Gladys accepte 2000 appareils au plus.`
          : '',
        protocol3
          ? `Le broker ne gère pas MQTT 5 : il ne limite pas la taille des messages qu’il envoie ; un message de plus de ${MAX_PACKET_MB} Mo coupe la connexion.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    ),
  unreachable: (reason) =>
    both(
      `MQTT broker unreachable (${reason}): next try in a moment.`,
      `Broker MQTT injoignable (${reason}) : nouvel essai dans un instant.`,
    ),
  lost: both(
    'Connection to the MQTT broker lost: reconnecting…',
    'Connexion au broker MQTT perdue : reconnexion…',
  ),
  stopped: (wait) =>
    both(
      `The MQTT broker refused the credentials earlier: next try in ${wait}, or save other credentials, or use "Test the connection".`,
      `Le broker MQTT a refusé les identifiants : nouvel essai dans ${wait}, ou enregistrez d’autres identifiants, ou utilisez « Tester la connexion ».`,
    ),
  refused: (reason, wait) =>
    both(
      `The MQTT broker refused the credentials (${reason}): next try in ${wait}, or save other credentials, or use "Test the connection".`,
      `Le broker MQTT a refusé les identifiants (${reason}) : nouvel essai dans ${wait}, ou enregistrez d’autres identifiants, ou utilisez « Tester la connexion ».`,
    ),
};

/** The answers of the "Test the connection" button. */
export const TEST = {
  ok: (controllers, outputs, offered) =>
    both(
      `It works: ${controllers} controller(s), ${outputs} output(s), ${offered} device(s) for Gladys.`,
      `Ça marche : ${controllers} contrôleur(s), ${outputs} sortie(s), ${offered} appareil(s) pour Gladys.`,
    ),
  refused: (reason) =>
    both(
      `The MQTT broker refused the credentials (${reason}).`,
      `Le broker MQTT a refusé les identifiants (${reason}).`,
    ),
  tooSoon: both(
    'Already tested a few seconds ago: try again in a moment.',
    'Déjà testé il y a quelques secondes : réessayez dans un instant.',
  ),
};

/** The errors of a command (shown by Gladys when a command fails). */
export const ERRORS = {
  readOnly: both('This feature cannot be controlled.', 'Cette fonction ne se commande pas.'),
  badValue: both('Value not accepted.', 'Valeur refusée.'),
  notConnected: both(
    'The MQTT broker is not connected: the command was not sent.',
    'Le broker MQTT n’est pas connecté : la commande n’a pas été envoyée.',
  ),
  gatewayOffline: both(
    'The Qbus MQTT gateway is offline: the command was not sent.',
    'La passerelle MQTT Qbus est hors ligne : la commande n’a pas été envoyée.',
  ),
  controllerOffline: both(
    'The Qbus controller is not connected to the gateway: the command was not sent.',
    'Le contrôleur Qbus n’est pas connecté à la passerelle : la commande n’a pas été envoyée.',
  ),
  unknownDevice: both(
    'This device is not (or no longer) in the configuration of the gateway: the command was not sent.',
    'Cet appareil n’est pas (ou plus) dans la configuration de la passerelle : la commande n’a pas été envoyée.',
  ),
  unsafeOutput: both(
    'This output is not declared safe in the configuration: nothing sent. Use its "Turn on" / "Turn off" buttons, or declare it safe.',
    'Cette sortie n’est pas déclarée sûre dans la configuration : rien n’a été envoyé. Utilisez ses boutons « Allumer » / « Éteindre », ou déclarez-la sûre.',
  ),
  buttonsDisabled: both(
    'The "Turn on" / "Turn off" buttons are off: allow them in the configuration of the integration.',
    'Les boutons « Allumer » / « Éteindre » sont désactivés : autorisez-les dans la configuration de l’intégration.',
  ),
  ceilingBelowMin: (min, ceiling) =>
    both(
      `Refused: the minimum of the thermostat (${min} °C) is above the ceiling of the configuration (${ceiling} °C).`,
      `Refusé : le minimum du thermostat (${min} °C) dépasse le plafond de la configuration (${ceiling} °C).`,
    ),
  setpointsDisabled: both(
    'Setpoint commands are off: allow them in the configuration of the integration.',
    'Les commandes de consigne sont désactivées : autorisez-les dans la configuration de l’intégration.',
  ),
  badNumber: both('Not a temperature.', 'Ce n’est pas une température.'),
  badStep: (step) =>
    both(
      `The setpoint goes by steps of ${step} °C.`,
      `La consigne se règle par pas de ${step} °C.`,
    ),
  outOfRange: (low, high) =>
    both(
      `Refused: the setpoint must stay between ${low} and ${high} °C (limits of the configuration and of the thermostat).`,
      `Refusé : la consigne doit rester entre ${low} et ${high} °C (limites de la configuration et du thermostat).`,
    ),
  stillRunning: both(
    'Another setpoint command is running: try again in a few seconds.',
    'Une autre commande de consigne est en cours : réessayez dans quelques secondes.',
  ),
  tooSlow: both(
    'The thermostat did not answer in time: the command was not sent.',
    'Le thermostat n’a pas répondu à temps : la commande n’a pas été envoyée.',
  ),
  missingValue: both(
    'A value needed to decide is missing from the thermostat: the command was not sent.',
    'Une valeur nécessaire pour décider manque au thermostat : la commande n’a pas été envoyée.',
  ),
  notSent: (reason) =>
    both(`The command was not sent (${reason}).`, `La commande n’a pas été envoyée (${reason}).`),
  sentUnconfirmed: both(
    'Command sent, without confirmation: check the device in a moment.',
    'Commande envoyée, sans confirmation : vérifiez l’appareil dans un instant.',
  ),
};
