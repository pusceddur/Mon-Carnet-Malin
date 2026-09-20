# App Store — cosa resta da fare

Stato al 2026-09-20. Quello che c'è già è descritto in [README.md](README.md).

## Fatto

- [x] **Bundle locale** — l'app contiene la web app, niente `server.url`. Si apre e legge senza rete.
- [x] **Autenticazione a token** — bearer, CORS per `capacitor://localhost`. Il browser resta col cookie httpOnly.
- [x] **Server in produzione** — `APP_ORIGINS=capacitor://localhost`, deploy del 2026-09-20 16:47 UTC. Preflight verificato.
- [x] **Scanner VisionKit** — `VNDocumentCameraViewController`, bordi e prospettiva, più pagine di fila.
- [x] **OCR Vision on-device** — `VNRecognizeTextRequest` francese, innestato nell'interfaccia `OcrEngine` esistente.
- [x] **« Ouvrir dans Carnet Malin »** — tipi di documento nel `Info.plist` + lettura del file.

### Collegato all'interfaccia

- [x] **Pipeline OCR** — `client/src/ocr/pageEngine.ts` sceglie Vision quando c'è, tesseract.js altrimenti. Iniettato in `ProcessingQueue`; la scelta si fa una volta sola, alla prima pagina.
- [x] **Bottone « Scanner des pages »** nella pagina di import, visibile solo quando `isScannerAvailable()`.
- [x] **« Ouvrir dans… »** — `IncomingFileSync` in `App.tsx` accoda e apre `/parent/importer`; la pagina svuota la coda e cancella la copia dell'Inbox.

## Decisioni prese

**PencilKit: non si usa** (2026-09-20). Le annotazioni restano quelle vettoriali che ci sono già (`client/src/pencil/`, perfect-freehand): si sincronizzano fra dispositivi, si ri-ancorano al testo quando la pagina viene riletta, e si modificano anche dal browser. PencilKit restituirebbe un PNG, che in quel modello non entra: avremmo avuto due sistemi di annotazioni paralleli che non si parlano. Il plugin è stato rimosso, non lasciato dormiente.

## Da compilare e collaudare sul Mac — prima di tutto il resto

Il codice Swift è scritto ma **non è mai stato compilato**: niente Xcode su Windows. Prima di aggiungere altro:

- [ ] `npm run setup` e primo build. Correggere gli errori di compilazione.
- [ ] In `ipad/`: rilanciare `npm install` una volta (il plugin della voce si è spostato in `ios-app/plugins/native-speech/`).
- [ ] Scanner: provare su iPad vero (il simulatore non ha fotocamera).
- [ ] OCR: confrontare la resa su una pagina reale con quella di tesseract.js, e misurare i tempi.
- [ ] Import: provare « Ouvrir dans… » da Mail, Fichiers e iCloud Drive.
- [ ] Verificare che il token bearer regga il riavvio dell'app.

## Alleggerire il bundle

- [ ] Con l'OCR nativo attivo, escludere `ocr/` dal bundle iOS: **44 MB su 56**. Da fare in `scripts/build-web.mjs`, solo dopo che l'OCR nativo è collaudato su pagine vere.

## Funzioni native rimaste

- [ ] **`SFSpeechRecognizer`** — il bambino legge ad alta voce, l'app segue e verifica. Permessi già nel `Info.plist`. È la funzione più forte che manca per un'app sulla dislessia.
- [ ] **Share Extension vera** — oggi l'import passa dai tipi di documento (« Ouvrir dans… »), che copre Mail, Safari, Fichiers e iCloud Drive senza target aggiuntivi. Una Share Extension serve solo per ricevere da app che offrono « Partager » ma non « Ouvrir dans… ». Richiede un target Xcode separato e un App Group.
- [ ] Spotlight, Handoff, widget, `BGAppRefreshTask`: piccoli, opzionali.

## Requisiti App Store non tecnici

- [ ] **Acquisto in-app** se l'abbonamento è a pagamento (Guideline 3.1.1). Obbligatorio, 15% col Small Business Program. Niente link a pagamenti esterni dentro l'app.
- [ ] **Informativa privacy** raggiungibile + etichette App Privacy nella scheda.
- [ ] **Categoria Kids** se la scegli (5.1.4): niente analytics o pubblicità di terze parti senza consenso, parental gate prima di link esterni e acquisti. L'area genitori col PIN è già la forma giusta.
- [ ] Screenshot iPad, descrizione francese, età consigliata.
- [ ] Account App Store Connect e certificati di distribuzione.
