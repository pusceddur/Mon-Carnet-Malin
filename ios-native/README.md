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

Il codice Swift viene scritto su Windows, dove **non può essere compilato**. Quindi si va a fette verticali piccole: ogni fetta si compila e si prova sul Mac prima di passare alla successiva. Scrivere migliaia di righe non testate sarebbe buttarle.

La fondazione è un **Swift Package**, non un progetto Xcode: si verifica con `swift test` senza aprire nulla.

```sh
cd ios-native/CarnetKit
swift test
```

## Stato

### Fatto — fetta 1: dominio e client dell'API

- `Models/Domain.swift` — profili, preferenze di lettura, aiuti alla lettura, documenti, pagine. I nomi rispecchiano il JSON del server, quindi `Codable` non ha bisogno di mappature.
- `API/AuthStatus.swift`, `API/APIClient.swift` — client dell'API esistente con **autenticazione bearer**, quella già attiva in produzione dal 2026-09-20. Gestisce token, sessione scaduta, errori del server, offline.
- `Tests/` — 6 test con il JSON reale del server, risposte simulate via `URLProtocol`, nessuna rete.

### Prossime fette, in ordine

1. **Motore del testo francese** (`shared/src/text/`, 5 244 righe) — sillabazione, lettere mute, suoni, liaison, tokenizzazione, leggibilità. È il cuore dell'app e il pezzo più rischioso: si porta per primo, con i test esistenti tradotti in XCTest per verificare che il comportamento sia identico.
2. **Persistenza locale** — Core Data o SQLite al posto di IndexedDB, più il motore di sincronizzazione.
3. **Lettore** — tipografia per bambino, evidenziazione frase, righello, aiuti alla lettura.
4. **TTS** — `AVSpeechSynthesizer` (il plugin delle voci esiste già e la logica si riusa).
5. **Import e OCR** — PDFKit al posto di pdf.js, parser EPUB, Vision.
6. **Esercizi**, **matita** (PencilKit, qui ha senso perché non c'è un livello web da affiancare), **area genitori**.

## Nota sull'autenticazione

L'app nativa usa lo stesso modello di sessione del web: token casuale, solo lo sha256 sul server, revocabile da « Appareils connectés ». La differenza è il trasporto — `Authorization: Bearer` invece del cookie — perché un'app non è same-origin col server.

Sul dispositivo il token va nel **Keychain**: `TokenStore` è un protocollo apposta, e `InMemoryTokenStore` serve ai test. L'implementazione Keychain arriva con la prima fetta che gira davvero sul telefono.
