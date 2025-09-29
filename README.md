# Modern BVBS Korb Generator (MEP)

Dieses Projekt ist eine moderne Webanwendung zur Erstellung und Verwaltung von BVBS-Körben.
Sie unterstützt den gesamten Prozess vom Aufbau der Zonen bis zur Produktion und dem
Druck von Etiketten mit Barcodes.

## Funktionen
- **Generator** zum Erstellen und Bearbeiten von Korb-Zonen
- **Produktionsmodus** mit Übersicht gespeicherter Aufträge
- **Etikettendruck** inklusive Barcode-Generierung (bwip-js)
- **Mehrsprachigkeit** (Deutsch, Englisch, Polnisch, Tschechisch)
- Speicherung von Templates und Aufträgen im Browser (localStorage)

## Voraussetzungen
- [Node.js](https://nodejs.org/)

## Anwendung starten
```bash
npm install            # installiert die Abhängigkeiten (Express & Azure Service Bus Client)
npm start              # startet die Anwendung unter http://localhost:3000
```

Der integrierte Node.js-Server stellt neben den statischen Dateien auch eine Proxy-Route
(`/api/service-bus/messages`) bereit. Darüber können in GitHub Codespaces Service-Bus-
Nachrichten mithilfe einer Verbindungszeichenfolge abgerufen werden, ohne an CORS zu
scheitern.

## Projektstruktur
- `index.html` – Einstiegspunkt der Anwendung
- `generator.js` / `production.js` – Logik für Generator- und Produktionsansicht
- `i18n.js` & `lang/` – Übersetzungslogik und Sprachdateien
- `styles.css` – Stylesheet
- `flags/` – Flaggen für die Sprachwahl

Weitere Informationen zur Bedienung findest du in [`instruction.md`](instruction.md).

