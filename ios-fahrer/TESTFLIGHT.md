# TestFlight: Texte zum Einfügen (TRISAR Fahrer, externe Tester)

Stand 05.11.2026, Build 0.1.0 (2).

## TestFlight → Testinformationen

**Beta-App-Beschreibung**

TRISAR Fahrer ist die App für Fahrerinnen und Fahrer eines Chauffeur- und Shuttledienstes. Die Disposition teilt Fahrten zu, die App zeigt die nächste Fahrt mit Abholort, Gast, Ziel und Route und führt Schritt für Schritt durch die Fahrt. Der Standort wird während des Dienstes an die Disposition übertragen, damit sie Ankunftszeiten sieht.

**Was soll getestet werden**

Anmeldung, Anzeige der zugeteilten Fahrten, Ablauf einer Fahrt (Anfahrt, Abholung, Ziel), Fahrzeugansicht, Support-Chat und Schadensmeldung.

**Feedback-E-Mail**

team@trisar.de

## TestFlight → Testinformationen → Informationen zur Beta-App-Prüfung

**Anmeldung erforderlich:** ja

- Benutzername: `apple.pruefung`
- Passwort: trägst du selbst ein (das Passwort, das du über den Link in der Mail an stefano.spandri@trisar.de gesetzt hast)

**Kontakt:** dein Name, team@trisar.de, deine Telefonnummer

**Hinweise für die Prüfung** (Englisch, Apple prüft auf Englisch)

TRISAR Driver is an internal app for chauffeurs of a ground transportation company in Munich, Germany. Accounts are created by the dispatch office; there is no public sign-up.

The demo account "apple.pruefung" is a dedicated review account. It is not assigned to any real rides, so after signing in the app shows "Hey aktuell gibt es keine Fahrt und kein Auto für dich" ("currently there is no ride and no car for you"). This is the expected state for this account. Profile, settings, ride history and support chat are reachable from the profile button at the top right.

Location: drivers share their location with the dispatch office while on duty, so dispatchers can see arrival times and the app can start and finish rides automatically when the driver reaches pickup and destination. "Always" location access keeps this working while the driver navigates with Google Maps or the screen is off. Location is only used for the drivers' own ride operations and is not sold or shared with third parties.

Camera and photos: used only to attach photos of vehicle damage in the damage report.

## Datenschutz-URL

Für externe Tests verlangt Apple unter **App-Informationen** eine Datenschutzrichtlinien-URL. trisar.de antwortet gerade mit Fehler 525 (Cloudflare kommt nicht zur Website durch), das sollte vorher wieder laufen.
