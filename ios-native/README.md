# App iPad nativa (SwiftUI)

Riscrittura nativa completa, **zero webview**. Decisa il 2026-09-20.

Sostituirà `ios-app/` (Capacitor, interfaccia in WKWebView), che resta per ora come riferimento del comportamento atteso e si cancella quando questa la supera. `ipad/` resta il guscio veloce per provare il sito su un iPad vero.

## Le dimensioni, senza giri di parole

| Da riportare in Swift | Righe | File |
|---|---|---|
| Area genitori | 4 216 | 26 |
| Matita e annotazioni | 3 867 | 16 |
| Lettore | 3 399 | 20 |
| Documenti e import | 3 383 | 17 |
| Esercizi | 2 568 | 24 |
| OCR | 2 491 | 18 |
| Design system | 2 214 | 26 |
| TTS | 1 147 | 4 |
| Testi francesi | 1 858 | 16 |
| Altro (sync, stato, compiti, domande) | ~2 300 | 21 |
| **Totale client** | **30 998** | **225** |
| **Logica condivisa** (sillabe, lettere mute, liaison, tokenizzazione, leggibilità) | **5 244** | 47 |

Sono mesi di lavoro. E la web app continuerà comunque a esistere per browser e dispositivi non Apple: **due codebase da mantenere**, per sempre.

## Come procediamo

Il codice Swift è stato scritto su Windows, dove **non può essere compilato**. Nessuna riga è mai passata da un compilatore: ci saranno errori, e il primo passo sul Mac è raccoglierli.

La fondazione è un **Swift Package** (`CarnetKit`): si verifica con `swift test` senza aprire Xcode. Sopra ci sta `CarnetMalin`, l'app, con il suo progetto Xcode già nella repo.

```sh
cd ios-native/CarnetKit && swift test   # la logica
open ios-native/CarnetMalin.xcodeproj   # l'app
```

Il confine è netto e voluto: **tutto ciò che si può testare senza schermo sta in `CarnetKit`** — testo francese, sillabe, OCR, EPUB, ancoraggio della matita, sincronizzazione. `CarnetMalin` è solo l'interfaccia. Per questo 5 233 righe di test coprono la parte che conta.

## Stato

### Fatto — fetta 1: dominio e client dell'API

- `Models/Domain.swift` — profili, preferenze di lettura, aiuti alla lettura, documenti, pagine. I nomi rispecchiano il JSON del server, quindi `Codable` non ha bisogno di mappature.
- `API/AuthStatus.swift`, `API/APIClient.swift` — client dell'API esistente con **autenticazione bearer**, quella già attiva in produzione dal 2026-09-20. Gestisce token, sessione scaduta, errori del server, offline.
- `Tests/` — 6 test con il JSON reale del server, risposte simulate via `URLProtocol`, nessuna rete.

### Fatto — fetta 2: basi del testo francese

- `Text/Normalize.swift` — forma canonica per confronti e chiavi di cache, e forma da mostrare al bambino (spazi insecabili francesi preservati, caratteri invisibili tolti).
- `Text/Tokenize.swift` — parole con **offset UTF-16**, elisioni separate dal clitico, apostrofi lessicali tenuti interi, trattini interni, decimali.
- `Text/SpokenText.swift` — §22, allineamento parola per parola fra testo mostrato e testo preparato per la voce.
- `Text/Dehyphenate.swift` — righe di OCR/PDF ricucite, parola spezzata a fine riga contro composto vero.
- `Tests/TextTests.swift` — gli stessi casi di `shared/test/text/normalize-tokenize.test.ts`, più i test degli offset.

**Perché UTF-16 e non indici Swift**: le annotazioni della matita sono ancorate al testo per offset, e quegli offset viaggiano nella sincronizzazione. Contare diversamente metterebbe i segni fatti sul web sulle parole sbagliate su iPad.

### Fatto — fetta 3: §26 « Couleurs de lecture »

Il pezzo più difficile del progetto, portato per intero (581 righe TypeScript → ~700 Swift).

- `Text/FrenchLexicons.swift` — le liste di eccezioni: finali sonore e mute, `ch` letto k, `ill` letto l, h aspiré, parole irregolari, parole che fanno liaison.
- `Text/FrenchCoding.swift` — il motore per parola: fine muta, nasali, gruppi che fanno un suono, lettere che cambiano suono, sillabazione scritta (V|CV, VC|CV, V|CCV con i gruppi inseparabili).
- `Text/FrenchCoding+Text.swift` — livello testo: parole, `-ent` di verbo dedotto dalla frase, liaison, e il formato leggibile `format`.
- `Tests/FrenchCodingTests.swift` — i casi di `shared/test/text/frenchCoding.test.ts`, paragrafi interi compresi.

### Fatto — fetta 4: frasi, parole, leggibilità

- `Text/Sentences.swift` — segmentazione in frasi: abbreviazioni, iniziali, numeri decimali, virgolette francesi, dialoghi, liste. Usa `NSRegularExpression`, che lavora su range UTF-16 come il resto.
- `Text/WordList.swift` — liste di parole normalizzate una volta sola, stopword francesi, stemming leggero.
- `Text/Readability.swift` — sillabe parlate (la e muta e la `-ent` verbale non si contano) e statistiche del testo, Kandel–Moles compreso.
- `Tests/SentenceTests.swift`, `Tests/ReadabilityTests.swift` — i casi dei test TypeScript, comprese le **140 parole annotate a mano** con la stessa tolleranza ±1.

### Fatto — fetta 5: passaggi, blocchi, numeri

- `Text/Passages.swift` — paragrafi, frasi localizzate con offset esatti, taglio in pezzi che non spezza mai un carattere a metà.
- `Text/Blocks.swift` — righe di layout (PDF o OCR) ricomposte in paragrafi e titoli: stacco verticale, salto di colonna, cambio di corpo, rientro.
- `Text/Numbers.swift` — « 1 000 », « mille », « M », « 3,5 », « XIXe », « dix-neuvième » ridotti alla stessa forma. Comprese le forme belghe e svizzere.
- `Tests/PassageTests.swift`, `Tests/NumberTests.swift` — tutti i casi dei test TypeScript.

### Fatto — fetta 6: lemmi

- `Text/LemmaData.swift` — 52 famiglie di verbi irregolari con i loro prefissi (« venir » + « de » → « devenir »), nomi e aggettivi irregolari, 120 regole di suffisso.
- `Text/Lemma.swift` — candidati divisi per affidabilità: la parola stessa, le forme irregolari elencate, le ipotesi dei suffissi. Chi cerca nel dizionario tiene il primo che esiste.
- `Tests/LemmaTests.swift` — oltre 150 coppie forma → lemma dai test TypeScript.

**Motore del testo francese: completo.** Resta solo `entities.ts`, che serve ai controlli anti-invenzione dell'IA e non al lettore.

### Fatto — fetta 7: entità

- `Text/Entities.swift` — numeri, anni e nomi propri di un testo. È il guardiano contro le invenzioni dell'IA: una risposta può contenere solo cifre e nomi che stanno nella pagina.
- `Tests/EntityTests.swift` — i casi dei test TypeScript.

## Il motore del testo francese è completo

Tutto `shared/src/text/` è portato: **14 moduli su 14**.

| | |
|---|---|
| normalize, tokenize, spoken, dehyphenate | ✅ |
| frenchCoding §26 (sillabe, lettere mute, liaison) | ✅ |
| segment, wordlist, stopwords, readability | ✅ |
| passages, blocks, numbers | ✅ |
| lemma, entities | ✅ |

### Fatto — fetta 8: persistenza e sincronizzazione

Qui non si traduceva più: IndexedDB non esiste su iOS, quindi il magazzino è stato riprogettato.

- `Storage/LocalStore.swift` — protocollo del magazzino, chiavi composte come quelle del server (`d1:3` per le pagine), coda delle modifiche in uscita.
- `Storage/InMemoryStore.swift` — implementazione completa in memoria. Non è uno stub: serve ai test e fa da riserva sul dispositivo se il file non si apre.
- `Sync/SyncTypes.swift`, `Sync/SyncEngine.swift` — attore che manda ciò che è in coda e riceve ciò che è cambiato altrove, con backoff e stato osservabile.
- `Tests/SyncTests.swift` — coda, chiavi composte, round multipli, riga rifiutata, fallimento di rete.

**Le righe restano JSON grezzo nel magazzino.** Il magazzino sposta righe senza doverle capire: un campo aggiunto sul server non va insegnato anche a lui.

**Il caso che conta di più**: una pagina che arriva senza testo (perché il genitore ha spento « sync du texte ») **non cancella** il testo che questo dispositivo ha letto dal libro. Il confronto è su `contentHash`. C'è un test per entrambe le direzioni.

### Fatto — fetta 9: magazzino su SQLite

- `Storage/SQLiteStore.swift` — la stessa interfaccia sopra un file, in WAL (si legge mentre la sincronizzazione scrive). Se il file non si apre, l'app ricade sul magazzino in memoria e lo dichiara, invece di rifiutarsi di partire.
- `Tests/StoreConformanceTests.swift` — **la stessa suite gira su entrambi i magazzini**. Il motore di sincronizzazione è testato su quello in memoria mentre l'app gira su SQLite: una differenza fra i due significherebbe test che non dimostrano nulla sul codice che spedisci.

Perché SQLite e non Core Data: quello che si salva sono già righe con una chiave e un blob JSON, cioè ciò che il server manda. Core Data aggiungerebbe un modello da tenere allineato a quello del server senza guadagno, e la coda in uscita — che è una fila ordinata — sarebbe più scomoda di una tabella con un contatore.

### Fatto — fetta 10: modello del lettore

- `Reader/ReaderModel.swift` — il testo di una pagina trasformato in quello che il lettore disegna: parole, frasi, pezzi intermedi, e i modi di puntare (parola sotto il dito, frase, paragrafo, selezione allargata a parole intere).
- `Tests/ReaderModelTests.swift` — 14 test.

**La regola che regge quasi tutto**: niente di visibile può essere irraggiungibile. Un pezzo di testo che il segmentatore lascia fuori da ogni frase verrebbe comunque disegnato, ma non si potrebbe evidenziare né far leggere — e dal lato del bambino sembra che l'app salti un pezzo di pagina. Un test verifica che **ogni parola appartenga a una frase**, su cinque forme di testo diverse.

Un altro verifica che i pezzi disegnati **ricompongano esattamente** il testo di partenza.

### Fatto — fetta 11: lettura ad alta voce

- `Reader/SpeechQueue.swift` — le pagine trasformate nella coda che la voce percorre, una frase alla volta.
- `Reader/SpokenWordMapping.swift` — porta la posizione della voce dal testo **parlato** a quello **mostrato**.
- `Reader/SpeechReader.swift` — `AVSpeechSynthesizer`, pause fra frasi e fra paragrafi, salto avanti e indietro, sessione audio.
- `Tests/SpeechTests.swift` — 12 test su coda e mappatura.

**Il pezzo che conta è la mappatura.** Quando una frase ha una versione preparata (§22), la voce legge quella e riporta le posizioni dentro *quella*, mentre la pagina mostra il testo come lo stampa il libro. Senza rimappare, l'evidenziazione scivolerebbe di un carattere per ogni virgola aggiunta, e il bambino vedrebbe il segno una parola indietro rispetto alla voce.

Funziona perché le due versioni contengono le stesse parole nello stesso ordine — cosa che viene verificata prima di usare la preparazione.

### Fatto — fetta 12: aiuti alla lettura e tipografia

- `Reader/ReadingAidsModel.swift` — §26 trasformato in tratti disegnabili: caratteri con lo stesso stile uniti in un unico run, così non si spezza la forma delle lettere. Ogni aiuto si accende da solo: cinque marche sulla stessa parola non aiutano più nessuno.
- `Reader/Typography.swift` — i valori in em del profilo diventano punti, con i tre temi. Carta mai bianco puro, inchiostro scuro mai bianco puro.
- `Tests/ReadingAidsTests.swift` — 14 test.

**Un valore fuori scala viene riportato dentro**, non creduto: un profilo vecchio o danneggiato non deve rendere il testo illeggibile.

### Fatto — fetta 13: esercizi

- `Exercises/ExerciseTypes.swift` — le cinque forme di domanda, con **Codable scritto a mano**. Swift codificherebbe volentieri un enum a modo suo; qui non può: sul filo una domanda è un oggetto piatto con un campo `type`, ed è quello che il server salva e che scrive l'app web. Un capitolo preparato su un dispositivo deve arrivare leggibile sull'altro.
- `Exercises/ExerciseCorrection.swift` — la correzione delle domande chiuse **sul dispositivo**, senza modello e senza rete.
- `Exercises/LocalQuestions.swift` — le domande che l'app scrive da sola a partire dal solo testo.
- `Tests/ExerciseTests.swift` + `Tests/LocalQuestionTests.swift` — 39 test.

**Perché correggere in locale conta.** Tutto tranne la risposta libera si giudica qui. Detto così sembra un'ottimizzazione; in pratica è la differenza fra un bambino che in treno riceve una risposta subito e uno che legge « pas de connexion ».

**Un errore non è mai solo « faux ».** Chi usa questa app si è già sentito dire molte volte che ha sbagliato. Una risposta sbagliata dice qual era quella giusta, perché, e quale passaggio rileggere. Il verdetto `partiel` esiste per lo stesso motivo: dire a chi ha indovinato metà delle coppie che ha sbagliato è falso, oltre che scoraggiante. Le spiegazioni si tagliano **a frase intera** entro un budget di 50 parole — un troncamento a metà frase lascerebbe in mano proprio a lui una riga che non si può leggere.

**Le domande locali sono più umili di quelle di un modello, ma sono sempre sul libro davanti.** Tre forme soltanto: una parola tolta, un ordine da rimettere, una frase da confermare.

- I distrattori vengono **dallo stesso testo**, stessa classe di lunghezza, stesso posto grammaticale, dove possibile stessa terminazione. Presi altrove, il bambino li esclude senza leggere: la risposta giusta sarebbe l'unica che appartiene alla storia. Si controlla anche l'elisione — « l'intérieur » ma « la pression » — perché una scelta che rompe l'elisione si vede da lontano.
- Vero/falso propone **solo frasi vere**, citate. Inventarne una falsa richiederebbe di capire il testo abbastanza da contraddirlo, e una falsità plausibile davanti a un bambino che sta ancora imparando a leggere è peggio di nessuna domanda.
- Nomi propri e numeri non si nascondono mai: chiedere di completare « ____ est arrivé » con un nome è chiedere di ricordare, non di leggere.

**Il generatore pseudo-casuale è fissato ai valori dell'app web** (mulberry32, con un test che confronta le sequenze). Non è pignoleria: stesso libro e stesso seme devono dare lo stesso esercizio su iPad e nel browser, altrimenti il bambino riceve domande diverse a seconda del dispositivo che ha preso in mano. Per lo stesso motivo gli ordinamenti a pari merito usano un `stableSorted` scritto a mano — `sort` di Swift non è stabile, quello di JavaScript sì.

### Fatto — fetta 14: import, EPUB, OCR

- `Documents/Hashing.swift` — sha256 e `contentHash` (§5), fissati ai valori che calcola l'app web.
- `Documents/DocumentTypes.swift` — `DocumentMeta`, `PageContent`, `ReadingProgress`, `ReadingSession`.
- `Documents/DocumentParser.swift` — righe lette → blocchi, che cos'è un file importato, da che cosa dipende lo stato di una pagina.
- `Documents/Epub/` — `XmlParser`, `ZipArchive`, `EpubBlocks`, `EpubPagination`, `EpubReader`.
- `Documents/PDFReader.swift` — PDFKit, righe con la loro posizione.
- `OCR/OcrTypes.swift`, `OCR/Quality.swift`, `OCR/VisionOcr.swift`.
- `Tests/EpubTests.swift`, `Tests/DocumentTests.swift`, `Tests/OcrTests.swift` + `Tests/ZipWriter.swift` — 94 test.

**Il punteggio OCR decide che cosa vede il bambino e che cosa il genitore deve controllare.** Per questo non si fida della confidenza del motore: un motore è sicuro delle sciocchezze quanto delle parole. Il segnale più forte è il più semplice — quello che è stato letto assomiglia al francese? Una pagina di parole vere passa anche con un motore mediocre; una pagina di sciocchezze scritte con sicurezza viene intercettata prima che il bambino la incontri. Sotto soglia la pagina **non viene nascosta**: si apre con un avviso, perché un bambino che ha accanto l'immagine originale spesso legge una pagina che la macchina non ha letto.

**Lo zip e il parser XML sono scritti a mano, ed è una decisione.** Un EPUB arriva da fuori: è la parte più esposta a un file malformato o ostile. Ogni lunghezza letta dal file viene confrontata con la dimensione reale prima di essere usata, nessuna entry viene espansa oltre un tetto fisso, i percorsi che risalgono fuori dall'archivio sono rifiutati. Sul fronte opposto, `XMLParser` di Foundation sarebbe la scelta ovvia ed è quella sbagliata: i libri veri sono pieni di `<br>` non chiusi, entità HTML non dichiarate, `&` isolate. Un parser rigoroso si ferma al primo — e per il bambino che aspetta di leggere è indistinguibile da un'app rotta.

**Un EPUB non ha pagine, ma l'app sì**, perché tutto il resto ci è ancorato: il segnalibro, i segni a matita, « riassumi le pagine 4-6 ». Il taglio cade **solo fra due blocchi**, mai dentro un paragrafo, e una pagina non finisce mai su un titolo. Un libro oltre il tetto di 500 pagine viene **rifiutato**, non troncato: importarne metà e mostrarlo come intero lascerebbe un bambino alla fine del capitolo nove a non trovare niente.

**Vision legge sul dispositivo.** La pagina che un bambino scansiona è il suo compito, il suo libro, a volte il suo nome e la sua scuola sulla prima riga. L'immagine non esce dall'iPad.

**Il ripulitore dei bordi** toglie l'ombra della rilegatura e la polvere che il motore legge come parole di una o due lettere. Lasciate lì, finiscono lette ad alta voce: il bambino che segue la voce col dito sente « l » fra le frasi e non ha modo di sapere che la pagina è a posto e la macchina no. Le parole con apostrofo si tengono sempre — i motori sono insicuri di « l' » e « d' » per principio, e sono parole vere che reggono la frase.

### Fatto — fetta 15: matita

*Niente PencilKit.* Il formato dei tratti deve restare identico a quello dell'app web, perché i segni di un libro viaggiano nella sincronizzazione e devono ricadere sulle stesse parole sugli altri dispositivi.

- `Pencil/InkTypes.swift` — i tre spazi di coordinate, le tre forme di annotazione, **Codable scritto a mano** per il formato sul filo.
- `Pencil/Geometry.swift` — distanze, intersezioni, box, hit test dell'elastico.
- `Pencil/StrokeEditing.swift` — gomma parziale, semplificazione, tetto sul numero di punti.
- `Pencil/TextLayout.swift` — parole misurate, evidenziatore, gomma sulle evidenziazioni.
- `Pencil/Anchoring.swift` — un tratto ancorato al testo e riportato sullo schermo.
- `Pencil/Reanchor.swift` — §15.7, ritrovare i segni dopo che il testo è cambiato.
- `Tests/PencilTests.swift` — 52 test.

**Tre spazi di coordinate, perché un segno significa tre cose diverse.** Una nota accanto a una parola appartiene a *quella parola* e deve seguirla quando il testo si rifluisce o viene riletto; un cerchio su una pagina scansionata appartiene a *quel punto della carta*; una risposta in una casella appartiene alla *casella*. Salvarli tutti in pixel di schermo li renderebbe tutti sbagliati al primo movimento.

**Il tratto che attraversa due righe ha due ancore.** Una parentesi lungo un margine, una linea che unisce due idee: ogni punto è misurato rispetto a un'origine interpolata fra la parola iniziale e quella finale. Così dopo un rifluimento il tratto si tende fra le stesse due parole invece di stendersi su quello che capita — e se niente si è mosso, l'interpolazione è esatta e il tratto è dove il bambino l'ha fatto.

**Nella casella di risposta x e y sono entrambe frazioni della LARGHEZZA.** La casella cresce in altezza mentre il bambino scrive: misurare la verticale sull'altezza schiaccerebbe quello che ha già scritto a ogni riga nuova, sotto la sua mano.

**Il ri-ancoraggio (§15.7) è la parte che conta di più.** Una pagina viene riletta — un OCR migliore, una correzione del genitore, lo stesso libro reimportato — e le parole si spostano. Quattro passi, dal più economico e sicuro al più incerto: l'hash del blocco è identico e le parole sono ancora lì; le stesse parole trovate esattamente, nel blocco o nel più vicino; parole quasi uguali (Jaccard ≥ 0,8); niente. **Un orfano non viene mai cancellato**: resta e finisce in « Mes notes ». I segni di un bambino su un libro sono il suo lavoro — quello che ha trovato difficile, quello che voleva ricordare, dove si è fermato. Perderli perché un genitore ha corretto un refuso gli insegnerebbe a non segnare più niente.

**La gomma parziale taglia dove il bambino ha passato il dito**, non al punto registrato più vicino: le estremità dei frammenti si cercano per bisezione sul bordo della gomma. Senza, cancellare in mezzo a una lettera lunga la porterebbe via tutta, e chi stava correggendo un errore perderebbe la riga che gli piaceva.

**La pressione è parte della forma del tratto** — è quello che rende una linea sottile all'inizio di una lettera e spessa in mezzo. La semplificazione RDP tiene anche i punti dove la pressione cambia; appiattirla restituirebbe al bambino una linea che non è quella che ha disegnato.

### Fatto — fetta 16: l'app

`CarnetMalin/` è l'applicazione vera e propria: SwiftUI sopra `CarnetKit`. `CarnetMalin.xcodeproj` è nella repo e si apre con Xcode 16 o più recente.

- `App/` — `CarnetMalinApp`, `AppModel` (la macchina a stati dell'app), `LibraryStore` (lettura e scrittura dei dati di famiglia).
- `Strings/FR.swift` — tutto quello che l'app dice, portato da `client/src/i18n/fr/`.
- `Design/` — palette, tipografia, i componenti condivisi.
- `Screens/` — accesso, scelta del lettore, home, libreria, lettore, esercizi, note, area genitori, import.
- `Screens/Reader/` — il cuore: testo con TextKit, aiuti §26, voce, selezione, matita.
- In `CarnetKit`: `KeychainTokenStore` e `APISyncTransport`, che mancavano.

**Il testo è disegnato con TextKit, non con `Text`.** Non è una scorciatoia: il lettore ha bisogno di tre cose che `Text` non dà. Il rettangolo esatto di ogni parola, perché un tratto ci si ancori e l'evidenziatore sappia che cosa ha attraversato; l'offset di carattere da un punto, perché un tocco cada *su* una parola e non accanto; attributi per carattere per il §26 che non spostino il layout.

**Modalità lettura e modalità annotazione, separate.** Non una matita sempre viva: una mano appoggiata sulla pagina mentre si legge non deve lasciare una riga attraverso il paragrafo. E con l'Apple Pencil il dito continua a far scorrere la pagina — chi appoggia la mano per scrivere non perde quello che aveva scritto.

**La velocità della voce è sulla barra, non nei réglages.** Una voce troppo veloce è il motivo più comune per cui un bambino smette del tutto di usarla; sepolta in un pannello, resta sbagliata.

**Un errore in un esercizio non è rosso.** Un errore qui è un passo, non una segnalazione, e questi bambini hanno già visto abbastanza rosso. E « partiel » esiste apposta.

**Nessuna etichetta medica in nessuna schermata.** Ogni impostazione porta il nome di quello che fa alla pagina: « Syllabes en couleurs », « Lettres muettes en gris ». Un bambino che legge « dyslexie » sulla propria schermata impara che l'app lo pensa come una diagnosi.

**Le note orfane non si cancellano mai.** Se il testo sotto un segno cambia e non si ritrova, il segno resta e finisce in « Mes notes », con una riga che spiega perché.

**Il login ha due passi** — prima l'indirizzo del server di famiglia, poi l'account — perché questa app non parla con un servizio: parla con un server che la famiglia ha in casa, a un indirizzo che conosce solo lei.

### Fatto — fetta 17: l'aiuto (AI)

- `AI/AITypes.swift` — le dieci operazioni, un tipo di richiesta per ciascuna che sa che cosa risponde; i quattro esiti; i messaggi per il bambino portati parola per parola da `KID_MESSAGES`.
- `AI/SummaryPlan.swift` — il taglio del libro per il riassunto progressivo (§15.4).
- `AI/AIService.swift` — cache sul dispositivo, attesa dei job lunghi, riassunto a pezzi con ripresa dei pezzi persi.
- `Models/ParentSettings.swift` — che cosa il genitore permette; letto dal server e tenuto per l'offline.
- `Exercises/ExerciseGeneration.swift` — domande scritte dall'aiuto, controllate prima che il bambino le veda; correzione delle risposte scritte.
- App: `Help/HelpSheet`, `Help/SummaryView`, `Help/FreeQuestionView`, `Exercises/ExerciseSetupView`.
- `Tests/AITests.swift` + aggiunte a `ExerciseTests.swift` — 34 test.

**Il piano del riassunto è fissato ai valori reali dell'app web**, calcolati con `planChunks` sullo stesso testo e scritti nel test. Il server tiene il riassunto di ogni pezzo sotto il suo hash: se l'iPad e il browser tagliassero lo stesso libro in modo diverso, ognuno pagherebbe di nuovo il lavoro dell'altro.

**La cache porta sempre la famiglia nella chiave.** Due famiglie possono usare lo stesso iPad una dopo l'altra; una non deve mai ricevere una risposta scritta sul libro dell'altra. Al logout la cache si svuota. Le domande libere, la scrittura a mano e le correzioni di testo **non si mettono mai in cache**: il genitore vede ogni domanda fatta, e una copia locale salterebbe quel passaggio.

**Un pulsante che il genitore ha spento non si mostra**, invece di mostrarsi e poi rispondere « non disponibile ». Un bambino che preme « Explique » e legge sempre la stessa scusa impara che il pulsante mente.

**Una risposta scritta che nessuno ha potuto correggere non riceve un verdetto finto.** Niente « Presque ! »: il bambino vede la risposta attesa e le idee importanti, e confronta da solo.

**Niente viene generato sul dispositivo quando l'aiuto non risponde** (decisione del 2026-09-19, uguale nell'app web). `LocalQuestions` è portato e testato ma non chiamato, in nessuna delle due app: domande costruite dal solo testo sono state giudicate troppo povere per essere un esercizio. Se lo si vuole come ripiego offline, è una riga.

### Fatto — fetta 18: pagina originale, règle de lecture, immagini

- `Documents/PageImages.swift` — le immagini delle pagine sul dispositivo, download, upload multipart, coda di upload che aspetta il sync.
- App: `Reader/OriginalPageView` (zoom con pinch e doppio tocco), `Reader/ReadingGuideBand`, `App/PageImaging` (JPEG senza metadati, rendering delle pagine PDF scansionate).

**L'upload dell'immagine è ciò che fa partire la lettura sul computer di casa** (§17.5). Prima di questa fetta le pagine scansionate importate dall'iPad restavano `awaitingAi` per sempre: nessuno le mandava. Ora vengono lette subito sul dispositivo con Vision (il bambino può aprirle offline) **e** spedite dopo il sync, quando il genitore lo permette; la lettura di casa, quando arriva, sostituisce quella locale.

**Le immagini stanno in Application Support, non in Caches**: una pagina scansionata non esiste da nessun'altra parte finché non è stata caricata, e il sistema non deve poterla cancellare per fare spazio. Escluse dal backup iCloud.

**La règle de lecture segue la voce** mentre legge, salta alla parola toccata, si trascina dalla maniglia. Non intercetta nessun tocco sul testo: una règle che impedisse di toccare le parole verrebbe spenta.

### Fatto — fetta 19: area genitori e compiti

- **Lettori**: creare, modificare, eliminare (`API/ChildrenAPI.swift`, `Parent/ChildSettingsView`). Una famiglia nuova che usa solo l'iPad prima restava bloccata a « Pas encore de profil ».
- **Libri**: elenco di tutti i libri della famiglia, rinominare, a chi è destinato, tipo di testo (§17.10), preparazione della lettura (§22), rilancio della lettura intelligente (§17.5), eliminazione (`API/DocumentsAPI.swift`, `Parent/DocumentsAdminView`).
- **Editor di pagina** (`Parent/PageEditorView`): « À vérifier » ora porta da qualche parte. Immagine originale sopra, blocchi modificabili sotto; i segni del bambino vengono spostati sul nuovo testo prima di salvare.
- **Options** (`Parent/OptionsView`): ogni funzione dell'aiuto, limiti, budget, prudenza, riservatezza — modificate come bozza e salvate in un colpo.
- **Activité** (`API/ActivityAPI.swift`, `Parent/ActivityView`): minuti, pagine, parole cercate, ascolto, sedute; allerte da segnare come viste; budget; domande libere degli ultimi 30 giorni. **Mai errori**: un numero che il bambino può sbagliare trasformerebbe la lettura a casa in una prova.
- **Sedute di lettura**: il lettore ora le registra (prima `ReadingSession` non veniva mai scritta, e il resoconto sarebbe stato vuoto).
- **Compiti** (§19.3): « Mes devoirs » in home, il bambino fotografa la scheda **senza codice**, la completa con matita e **zone di testo** (§19.2) sull'immagine originale, « Corriger » (§24) mostra le correzioni prima di sostituire, « J'ai terminé », esportazione PDF da stampare o mandare.
- `App/DocumentImporter.swift`: un solo import per genitore e bambino, invece di due che divergono piano piano.

**I lettori passano dalle rotte REST, non dal sync.** Il sync accetta dai profili solo `reading` e `tts` — quello che il bambino può cambiare da solo. Nome, età, livelli ed esercizi mandati col sync venivano ignorati e segnalati `forbidden`: la modifica del genitore spariva in silenzio.

**« Corriger » non sostituisce niente da solo.** Mostra il testo corretto e le coppie *prima → dopo*; il bambino sceglie. Una correzione che riscrivesse la sua risposta di nascosto gli insegnerebbe che la sua scrittura è una cosa che gli viene tolta.

### Fatto — fetta 20: risposte a mano, account, glossario, « Ouvrir dans… »

- **Risposte scritte a mano** (`Exercises/Handwriting.swift`, `Exercises/FreeAnswerInput`): il bambino può rispondere con la matita invece che con la tastiera. Il tratto resta un'annotazione vettoriale (spazio `answer`), l'immagine inviata al riconoscimento è rasterizzata solo al momento, ritagliata sull'inchiostro e mai più grande di 1 600 px / 1 MB. Riconoscimento solo se il genitore l'ha permesso; il bambino rilegge e corregge il testo riconosciuto prima di mandarlo.
- **Account** (`API/AccountAPI.swift`, `Parent/AccountView`): appareils connectés con disconnessione a distanza (anche « tutti gli altri »), cambio password e cambio codice adulti — entrambi chiedono di nuovo la password. L'iPad si presenta come « iPad · application ».
- **Glossaire** (`API/GlossaryAPI.swift`, `Parent/GlossaryView`): le definizioni del genitore, che passano prima di quelle dell'aiuto. Controlli prima dell'invio: parola, definizione di 30 parole al massimo, doppioni.
- **« Préparer la lecture » dal lettore** (§22, `Reader/ReadingPreparation`): nella barra della voce, per la pagina a schermo. Poi un sync ogni 10 s per 3 minuti; la pagina preparata compare senza chiudere il libro. Il lettore ora ricarica le pagine dopo ogni sync (`refreshPages`), anche per una pagina appena letta dal computer di casa.
- **Écriture corrigée** (§24, `ActivityView`): i testi corretti con « Corriger », conteggio per tipo sull'anno, le fautes che ritornano, testo del bambino e testo corretto.
- **« Ouvrir dans Carnet Malin »** (§29, `App/IncomingFiles.swift`, `Support/Info.plist`): PDF, EPUB e foto da Mail, Safari, Fichiers, iCloud Drive. Il file viene copiato nello spazio dell'app, la copia dell'Inbox cancellata; aspetta l'area adulti (codice compreso), dove si sceglie per chi è. Chiudere senza aggiungerlo lo scarta: non ricompare da solo.

**`Support/Info.plist` è parziale.** Il resto viene dalle impostazioni di build (`INFOPLIST_KEY_*`): lì dentro solo quello che le impostazioni non sanno esprimere — i tipi di documento, e i font quando arriveranno. Sta fuori da `CarnetMalin/` apposta: dentro la cartella sincronizzata Xcode lo copierebbe anche fra le risorse, e la build fallirebbe con « Multiple commands produce Info.plist ».

### Fatto — fetta 21: quello che il web aveva e l'app no

- **Mes notes** (`Pencil/NotesModel.swift`, port di `notesModel.ts`, con test): le risposte scritte o disegnate agli esercizi, le note staccate dal testo elencate una per una (non più solo contate), il libro si apre alla prima pagina annotata. Prima le zone di testo dei compiti e l'inchiostro delle risposte venivano contati come « disegni ».
- **« Relire le passage »** (`Reader/QuoteFinder.swift`, port di `findQuote`, valori fissati sul codice TypeScript): dopo una risposta non ancora giusta l'esercizio riapre il libro sulla pagina con il passaggio evidenziato per 8 secondi. Lo stesso per le fonti dell'aiuto e del riassunto.
- **Profils de lecture** (§27, `Reader/ReadingProfiles.swift`, con test): cinque profili chiamati per quello che fanno, un tocco nella scheda del lettore; un valore cambiato a mano e il profilo diventa « Personnalisé ».
- **Diagnostica** (`API/Diagnostics.swift`, con test): i problemi tecnici del dispositivo — PDF illeggibile, OCR che fallisce, immagine che non si decodifica — vanno al server di famiglia, in lotti, una volta per sessione, mai il testo di una pagina. Un errore di sistema dà solo dominio e codice: la sua descrizione può contenere il percorso del file, e il nome del file quello del bambino.
- **« Tester la lecture sur cet appareil »** (`Parent/SelfTestView`): memoria, OCR, grande foto, PDF, server, su contenuti creati dal test stesso.
- **Account da iPad**: prima installazione del server e iscrizione con codice d'invito (`API/AccountForm.swift`, con test), « Mot de passe oublié » (il link dell'e-mail si apre nel browser, dove viene chiesto anche il codice).
- **Codice all'apertura dei Réglages** (§20, sì/no, confermato con la password), **stato del computer di casa** con uso dell'abbonamento e stima del mese (§17.5, §21) nelle Options.
- **Sincronizzazione** nell'area adulti: in attesa per tipo, righe rifiutate dal server con il motivo.

**Da sapere prima dell'App Store: cancellazione dell'account.** Un'app che permette di *creare* un account deve permettere di *cancellarlo* dall'app stessa (linea guida 5.1.1(v)). Il server oggi non ha una rotta per cancellare un account: va aggiunta sul server prima di pubblicare, oppure si toglie l'iscrizione dall'app (`SignInView`, due pulsanti).

### Bug trovati e corretti in queste fette

- **`null` omessi.** Il server valida con `.nullable()` (chiave obbligatoria, valore nullo); il `Codable` sintetizzato di Swift *omette* le chiavi `nil`. Ogni riga scritta dall'iPad con un campo vuoto — `deletedAt`, `confidence`, `verdict`… — sarebbe stata rifiutata dal sync come `invalid`, in silenzio. Ora `@NullCodable` su 15 campi e sulle richieste AI, con test che lo verificano per ogni tipo di riga.
- **Coordinate dei blocchi.** Ogni blocco misurava le sue parole nel proprio spazio, la matita disegnava in quello della pagina: tutti i tratti dopo il primo paragrafo si sarebbero ancorati alle parole sbagliate.
- **Evidenziazioni dopo una rilettura.** I tratti venivano ri-ancorati alla visualizzazione, le evidenziazioni no: dopo che il computer di casa rileggeva una pagina, avrebbero colorato le parole sbagliate.
- **Profili modificati via sync.** Vedi sopra: il server li scartava.
- **Pagine scansionate mai spedite.** L'upload dell'immagine è ciò che avvia la lettura di casa; nessuno lo faceva.

### Fatto — fetta 22: l'iPad si svuota quando la famiglia se ne va

Era il bug **P1** aperto in `docs/TODO.md` §1k: il web cancella i dati locali al logout (§20, per impostazione predefinita), l'app no. Su un iPad prestato, venduto o semplicemente usato da due account, la famiglia successiva trovava nel database locale i libri, le note, i compiti e le impostazioni della precedente — contro la regola §28 « nessuna condivisione tra famiglie ».

- **Una sola funzione** (`App/LocalWipe.swift`), perché i posti che ne hanno bisogno sono tre e tre copie divergono: la disconnessione, un account diverso che entra sullo stesso iPad, e domani la cancellazione dell'account. Cancella il database (righe e coda d'invio), le foto delle pagine, le risposte dell'aiuto, i file arrivati con « Ouvrir dans… » e non ancora aggiunti, i PDF dei compiti esportati, e il token nel portachiavi.
- **Resta solo ciò che è dell'iPad, non di nessuno**: l'indirizzo del server (per non riscriverlo), la voce scelta, il dito che disegna o scorre, e l'identificativo con cui il server elenca questo apparecchio in « Appareils connectés ».
- **Nel magazzino** (`LocalStore.removeEverything(keepingValues:)`, nei due magazzini con gli stessi test): su SQLite in una sola transazione — una pulizia interrotta a metà lascerebbe metà delle righe su un apparecchio che sta per cambiare mani — seguita da `VACUUM`, così le pagine della famiglia successiva non si scrivono sopra quelle della precedente.
- **Interruttore nella conferma** (`Screens/Parent/SignOutSheet.swift`), acceso per impostazione predefinita e con le stesse parole del web: « Effacer aussi les livres, les pages et les notes de cet appareil ». Prima della cancellazione ciò che è in attesa viene sincronizzato, e se qualcosa non è passato il numero viene detto.
- **Cambio di famiglia senza disconnessione** (`AppModel.forgetPreviousFamily`): l'app uccisa a metà logout, una sessione chiusa dal server, un iPad passato di mano. Il controllo è su ogni accesso — il genitore di prima contro quello che arriva — non solo nel logout.
- Anche lo stato del sync viene dimenticato (`SyncEngine.forgetSyncState`): « 12 éléments en attente » di una coda che non esiste più.
- I PDF dei compiti esportati finivano sciolti nella cartella temporanea, con il nome del compito sulla copertina: ora stanno in `exports/`, che si può svuotare.

Nella stessa fetta, l'allineamento al web di **« Première installation »**: il pulsante non c'è più nella schermata di connessione. Se il server non ha ancora nessun account, l'app lo dice e rimanda al browser — chi installa un server è davanti a un computer, e il codice d'installazione è suo, non della famiglia. `AccountForm.Mode.setup` resta in `CarnetKit` con i suoi test, perché la rotta sul server esiste ancora.

### Fatto — fetta 23: cancellazione account, colori, pre-réglages, soprannome

Cinque cose decise il 2026-09-22, tutte fatte in parallelo nel web e nell'app, come chiede il progetto.

- **« Supprimer le compte »** (§30, `Screens/Parent/DeleteAccountView.swift`): era il blocco certo della revisione Apple, perché l'app permette di creare un account. Immediata e definitiva. Lo schermo dice cosa sparisce prima di chiedere la password, e avverte che un eventuale abbonamento continua a essere fatturato. Riusa `LocalWipe.family` della fetta 22. Un `410 account_deleted` dal server fa la stessa cosa da solo: un iPad spento durante la cancellazione si svuota da sé quando torna in linea.
- **« Corriger » corregge anche la costruzione della frase** (§24.2b): « je suis été » diventa « j'ai été ». Era la funzione che il contratto prometteva e che il controllo anti-invenzione scartava, perché fra « je suis » e « j'ai » non c'è nessuna lettera in comune. Ora un ausiliare scambiato con l'altro passa, ma solo dentro un tempo composto: il participio deve esserci. Il lettore lo sente dire a parole, l'adulto lo vede etichettato « Construction de la phrase ».
- **Palette di colori** (§31.1, `ReaderTheme.of(theme, palette)`): tre insiemi di colori commutabili dal pannello Aa, indipendenti dal colore della carta. « Bien séparées » mette blu e arancione dove c'erano rosso e verde, perché le marcature §26 si appoggiano al colore più di qualsiasi altra cosa nell'app.
- **Tre pre-réglages** (§31.2, `ReadingProfile.quickStart`): un lettore nuovo vede tre modi di leggere ben diversi, non cinque schede e dodici cursori. Gli altri stanno dietro un link, e sotto la scelta c'è sempre la frase sull'orthophoniste.
- **Un lettore è un soprannome** (§32): `firstName` e `age` sono diventati `nickname`. L'età finiva in ogni prompt inviato al fornitore IA, per una lunghezza di frase che l'app ricava già dalla difficoltà delle spiegazioni. Ora l'app non la conserva affatto. La tastiera non propone più un nome vero (`textContentType` da `.givenName` a `.nickname`).
- **`PrivacyInfo.xcprivacy`**: senza questo file il caricamento su App Store Connect risponde `ITMS-91053`. Dichiara le due API a motivazione obbligatoria che l'app usa davvero: data di modifica dei file, per la cache dell'aiuto, e spazio libero, per « Tester la lecture ».

Il `ReadingPreferences` di `CarnetKit` ha ora un decodificatore scritto a mano: quello sintetizzato da Swift rifiuta una riga a cui manca una chiave, anche quando la proprietà ha un valore di partenza, e un profilo salvato prima di §31 non ha la palette. Ogni campo ricade sul valore standard invece di far fallire l'apertura dell'app.

## Costruirla sul Mac

```sh
git clone <repo> && cd ios-native

# 1. La logica, senza aprire Xcode
cd CarnetKit && swift test && cd ..

# 2. L'app
open CarnetMalin.xcodeproj
```

In Xcode: scegliere un simulatore iPad (o un iPad collegato), mettere il proprio team in **Signing & Capabilities**, e premere ▶.

Se `CarnetMalin.xcodeproj` non si aprisse (Xcode più vecchio di 16, o file rovinato dal trasferimento), c'è il piano B:

```sh
brew install xcodegen
cd ios-native && xcodegen generate
```

### Cosa manca ancora, e va fatto sul Mac

1. **I file dei font.** Lexend, Andika, Atkinson Hyperlegible e OpenDyslexic non sono nella repo (licenze e peso). Vanno messi in `CarnetMalin/Fonts/` e dichiarati in `UIAppFonts` dentro `Support/Info.plist`. **Finché non ci sono, l'app usa il font di sistema** — non si rompe niente, ma metà del senso di « Police » va perso.
2. **L'icona.** `Assets.xcassets/AppIcon.appiconset` è vuoto: serve un PNG 1024×1024.
3. **`swift test`, poi gli errori di compilazione.** Niente di questo codice è mai stato compilato: è stato scritto su Windows, dove non c'è un toolchain Swift. Ci saranno errori. Vanno raccolti e corretti.
4. Il resto della checklist App Store è in `ios-app/TODO.md`.

## Nota sull'autenticazione

L'app nativa usa lo stesso modello di sessione del web: token casuale, solo lo sha256 sul server, revocabile da « Appareils connectés ». La differenza è il trasporto — `Authorization: Bearer` invece del cookie — perché un'app non è same-origin col server.

Sul dispositivo il token va nel **Keychain** (`KeychainTokenStore`, solo su questo dispositivo, leggibile dopo il primo sblocco): `TokenStore` è un protocollo apposta, e `InMemoryTokenStore` serve ai test.
