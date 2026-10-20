# Qbus pour Gladys Assistant

Cette intégration apporte dans Gladys les sorties de vos contrôleurs
domotiques **Qbus** (CTD 3.x, la domotique filaire du fabricant belge Qbus),
**sur votre réseau local**, via la **passerelle MQTT Qbus** et **votre propre
broker MQTT**. Rien ne passe par Internet.

> Cette intégration n'a **jamais été testée avec une vraie installation
> Qbus** : elle suit le protocole de qbusmqttapi, la bibliothèque écrite par
> Qbus pour Home Assistant. Vos retours sont les bienvenus sur le forum. Non
> officiel, sans lien avec Qbus.

## Ce que vous obtenez

| Sortie Qbus                  | Dans Gladys                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Relais (marche/arrêt)        | un interrupteur                                                                                             |
| Variateur (analog)           | une lumière : marche/arrêt, luminosité                                                                      |
| Lumière couleur (multicolor) | une lumière : marche/arrêt, luminosité, couleur                                                             |
| Volet, store                 | un volet : ouvrir / fermer / stop, et sa position quand le contrôleur la donne                              |
| Thermostat                   | la température de la pièce et la consigne (commandes de consigne **désactivées par défaut**, voir plus bas) |
| Scène                        | un bouton poussoir « Lancer »                                                                               |
| Jauge                        | un capteur : température, humidité, CO2, luminosité, pression, puissance, courant, tension, vent            |
| Humidité, ventilation        | capteur d'humidité, capteur de CO2                                                                          |
| Station météo                | température extérieure, luminosité, vent, pluie                                                             |

Pas dans cette version : les sélecteurs (stepper), les régimes (préréglages)
des thermostats et des ventilations, les lames des stores vénitiens, les
effets des lumières couleur et les jauges cumulées (énergie, eau, gaz). Les
volets et les thermostats ne sont jamais des interrupteurs : un « éteins
tout » d'un assistant vocal ou d'une scène ne les atteint pas.

## Avant de commencer

1. Un broker MQTT sur votre réseau (Mosquitto, par exemple l'extension de
   votre NAS, ou le broker du serveur Qbus).
2. La **passerelle MQTT Qbus** (qbusMqttGw), installée et reliée à votre
   contrôleur Qbus et à ce broker, comme l'explique Qbus sur
   [iot.qbus.be](https://iot.qbus.be). Elle publie sous
   `cloudapp/QBUSMQTTGW/...`.
3. Dans Gladys, installez l'intégration depuis le store.

## Configuration

- **Adresse du broker MQTT** : l'adresse IP du broker (`192.168.1.20`,
  port 1883), ou `mqtts://adresse:8883` en TLS.
- **Utilisateur** et **Mot de passe** : ceux du broker, s'il en demande. Le
  mot de passe est gardé par Gladys dans sa base, jamais réaffiché, et envoyé
  seulement à votre broker. Il ne va jamais dans les journaux ni dans `/data`.
- **Vérifier le certificat TLS** : activé par défaut ; à désactiver
  seulement pour un broker au certificat auto-signé sur votre réseau.
- **Numéro de série du contrôleur** : vide pour tous les contrôleurs de la
  passerelle, ou le numéro d'un contrôleur (comme l'affiche Qbus System
  Manager).
- **Autoriser les commandes de consigne** : désactivé par défaut, voir plus
  bas.
- **Plafond des consignes** : 24 °C par défaut (16 à 30 °C).
- **Intervalle minimum entre deux mesures** : 10 s par défaut. Marche/arrêt,
  positions et consignes ne sont jamais retardés.
- **Langue des messages** : français ou anglais.

Utilisez ensuite **Tester la connexion** : il indique combien de
contrôleurs, de sorties et d'appareils la passerelle a. Les appareils
apparaissent dans l'onglet **Découverte** de l'intégration : créez ceux que
vous voulez.

## Consignes de chauffage

Les thermostats Qbus pilotent le chauffage. Gladys affiche toujours leur
température et leur consigne. **Changer une consigne depuis Gladys**
(tableau de bord, scènes, assistants vocaux) est refusé tant que vous
n'activez pas **Autoriser les commandes de consigne**. Une fois activé :

- la consigne reste entre 5 °C et le plafond de la configuration (24 °C par
  défaut, jamais au-dessus de 30 °C), et dans les limites que le contrôleur
  déclare pour le thermostat, par pas de 0,5 °C ;
- l'intégration relit d'abord le thermostat et son contrôleur, décide
  seulement sur cette relecture, et revérifie l'option et le plafond juste
  avant l'envoi ;
- la commande part dans les 3,5 s après le clic, ou elle est refusée, non
  envoyée ;
- si le contrôleur ne la confirme pas à temps, Gladys affiche « Commande
  envoyée, sans confirmation » : vérifiez le thermostat un instant plus tard.

## Erreurs et limites

- Jamais testé avec un vrai appareil : signalez sur le forum ce qui ne
  marche pas (avec les journaux de l'intégration).
- Identifiants refusés par le broker : l'intégration s'arrête et réessaie
  après 15 min, 1 h, 6 h, puis toutes les 24 h (conservé après un
  redémarrage). Enregistrer d'autres identifiants ou **Tester la connexion**
  réessaie tout de suite.
- Broker injoignable : un nouvel essai toutes les 10 s.
- Passerelle hors ligne, contrôleur déconnecté : le statut le dit, les
  appareils apparaissent « injoignables » et les commandes sont refusées,
  jamais mises en attente.
- Gladys accepte 300 états par minute : les mesures sont espacées, le reste
  part en premier.

## Assistance

Questions et retours : le forum de la communauté Gladys. Code source et
tickets : <https://github.com/LM1LC3N7/gladys-qbus>.
