# App iPad

Guscio nativo dell'app web: apre l'app dal server (gli aggiornamenti del sito arrivano senza ricompilare) e legge ad alta voce con le **voci di sistema dell'iPad**, comprese quelle scaricate con qualità « Migliorata » e « Premium », che Safari non mette a disposizione dei siti.

- `capacitor.config.js`: configurazione (indirizzo del server e bundle id letti da `.env`, mai versionato).
- `native-speech/`: plugin Swift della voce (voci, parola letta, interruzioni, schermo sempre acceso durante la lettura).
- `www/index.html`: pagina mostrata se il server non è raggiungibile alla prima apertura.
- `scripts/configure-ios.mjs`: completa il progetto Xcode generato (domini dell'app per l'uso offline, nome, icona, permessi fotocamera e foto).
- La cartella `ios/` è generata sul Mac e non è versionata (contiene il team di firma).

## Requisiti
- Un Mac con **Xcode 26** o successivo (Xcode 26.0 richiede almeno macOS Sequoia 15.6; le versioni successive di Xcode chiedono macOS più recenti). Xcode deve supportare la versione di iPadOS installata sull'iPad.
- Node 22 sul Mac.
- Un Apple ID (gratuito va bene).
- Il cavo per collegare l'iPad al Mac.

## Prima installazione
1. Copiare sul Mac la cartella del progetto (serve anche `client/public/icons/` per l'icona).
2. Nella cartella `ipad/`:
   ```sh
   cp .env.example .env        # poi scrivere l'indirizzo https del server in CARNET_SERVER_URL
   npm install
   npm run setup               # crea ios/ e lo configura
   npm run open                # apre Xcode
   ```
3. In Xcode: progetto **App** › target **App** › **Signing & Capabilities** › **Team**: scegliere il proprio Apple ID (Add Account… se non c'è). Se Xcode dice che il bundle id è già usato, cambiare `CARNET_APP_ID` in `.env` (es. `app.carnetmalin.ipad.nome`) e rilanciare `npm run sync`.
4. Collegare l'iPad con il cavo, sbloccarlo e rispondere « Autorizza » sull'iPad.
5. Sull'iPad: **Impostazioni › Privacy e sicurezza › Modalità sviluppatore** › attivare (l'iPad si riavvia).
6. In Xcode scegliere l'iPad come destinazione in alto e premere ▶︎ (Run).
7. Al primo avvio l'iPad chiede di fidarsi dello sviluppatore: **Impostazioni › Generali › VPN e gestione dispositivo** › il proprio Apple ID › **Autorizza**. Poi riaprire l'app.
8. Nell'app: accedere con il proprio account (la sessione di Safari non è condivisa). I libri e il testo arrivano con la sincronizzazione.

## Voci migliori
Sull'iPad: **Impostazioni › Accessibilità › Contenuto letto › Voci › Français** › scaricare una voce « Migliorata » o « Premium ». Nell'app: libro aperto › Réglages de lecture › Voix. La voce automatica sceglie la migliore disponibile.

## Con Apple ID gratuito: ogni 7 giorni
Il certificato gratuito scade dopo 7 giorni e l'app non si apre più. Basta ricollegare l'iPad al Mac e premere di nuovo ▶︎ in Xcode (i dati dell'app restano).

## Aggiornamenti
- Modifiche del sito: niente da fare, l'app le carica dal server.
- Modifiche di `native-speech/` o della configurazione: `npm run sync`, poi ▶︎ in Xcode.

## Funzionamento offline
L'app registra la stessa copia offline del sito (service worker) grazie ai domini dell'app in `Info.plist`: dopo una prima apertura con Internet, i libri già sincronizzati si leggono anche senza connessione.
