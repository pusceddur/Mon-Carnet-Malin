# App iPad per l'App Store

Seconda app, separata da `ipad/`. Le due convivono e servono a cose diverse.

| | `ipad/` | `ios-app/` (questa) |
|---|---|---|
| Contenuto del bundle | niente: apre il sito | **tutta l'app web** |
| Aggiornamenti del sito | immediati | con una nuova versione sullo Store |
| Funziona senza rete al primo avvio | no | **sì** |
| Autenticazione | cookie di sessione | **token bearer** |
| Adatta all'App Store | no (Guideline 4.2) | sì, è lo scopo |

`ipad/` resta comoda per provare in fretta le modifiche del sito su un iPad vero. Questa è quella che si pubblica.

## Perché il bundle locale

Apple rifiuta le app che sono un sito ripacchettato (**Guideline 4.2 – Minimum Functionality**). Un'app il cui bundle non contiene nulla e che punta una `WKWebView` su un indirizzo è esattamente quel caso. Qui i file stanno dentro l'app, quindi l'app si apre e legge i libri già scaricati anche in aereo.

Il bundle locale però cambia un dettaglio importante: le pagine girano su `capacitor://localhost`, mentre l'API sta sul server. Le chiamate **attraversano un'origine**, e un cookie non verrebbe mai spedito.

Per questo:

- il server deve elencare `capacitor://localhost` in **`APP_ORIGINS`** (senza, niente CORS e l'app non parla con l'API);
- l'app chiede il token di sessione una volta sola al login (intestazione `X-Aide-Client: native`) e poi lo rimanda come `Authorization: Bearer …`.

Nel browser non cambia nulla: resta same-origin e continua col cookie `httpOnly`. Il token non viene mai consegnato a un browser.

## Requisiti
- Mac con **Xcode 26+** e **Node 22**.
- Un Apple ID. Per il simulatore non serve nessun team di firma.

## Prima installazione

```sh
cd ios-app
cp .env.example .env
#   CARNET_API_BASE_URL=https://…      indirizzo del server
#   CARNET_APP_ID=app.carnetmalin.ios  identificativo unico
npm install
npm run setup     # build del client → www/, poi cap add ios e configurazione
npm run open      # apre Xcode
```

In Xcode scegli un **iPad simulator** e premi ▶︎. Per un iPad vero servono il team di firma e la modalità sviluppatore, come in `ipad/README.md`.

### Sul server, una volta sola

Nel `.env` di produzione:

```
APP_ORIGINS=capacitor://localhost
```

Poi riavvia. Finché la variabile è vuota il CORS resta spento e **niente cambia** per il sito: è il comportamento predefinito.

## Aggiornare

```sh
npm run sync      # ricostruisce il client, lo ricopia e aggiorna il progetto Xcode
```
Poi ▶︎ in Xcode. Ogni modifica del sito richiede questo passaggio: è il prezzo del bundle locale.

## Funzioni native

Ci sono già, e sono collegate all'interfaccia:

1. **Scanner documenti** (`VNDocumentCameraViewController`) — bordi e prospettiva corretti automaticamente.
2. **OCR on-device** (`VNRecognizeTextRequest`) — sostituisce tesseract.js dentro l'app: più preciso sul francese, e toglierà 44 MB su 56 una volta collaudato.
3. **« Ouvrir dans Carnet Malin »** — import da Mail, Safari, Fichiers e iCloud Drive.
4. **Voci di sistema** (`carnet-native-speech`) — vive qui e `ipad/` la prende in prestito.

**PencilKit non si usa**: le annotazioni restano vettoriali, sincronizzate e ri-ancorate al testo. Il motivo è in [TODO.md](TODO.md).

Manca ancora **`SFSpeechRecognizer`** (il bambino legge ad alta voce e l'app segue), più i requisiti non tecnici: acquisto in-app, informativa privacy, categoria Kids.

## Note

- `www/` e `ios/` sono generate: non si versionano e non si modificano a mano.
- Il bundle include gli assets OCR e pdf.js, quindi pesa 56 MB. Escludere `ocr/` una volta collaudato l'OCR nativo ne toglie 44.
- Dentro l'app il service worker non viene registrato: gli aggiornamenti passano dallo Store.
