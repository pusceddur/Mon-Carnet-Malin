#!/bin/bash
#
# Prima verifica sul Mac: compila la logica, i test e l'app, e mette tutto in un file solo.
#
#     cd ios-native && bash verifica-mac.sh
#
# Non firma niente e non installa niente sull'iPad: serve solo a far uscire gli errori di compilazione.
# Alla fine stampa dove sta il registro, da riportare indietro così com'è.

set -u
cd "$(dirname "$0")"

LOG="$PWD/verifica-$(date +%Y%m%d-%H%M).log"
: > "$LOG"

titolo() {
  printf '\n\033[1m%s\033[0m\n' "$1"
  printf '\n\n========================================\n%s\n========================================\n\n' "$1" >> "$LOG"
}

# 1. Gli attrezzi ci sono?
titolo "1. Attrezzi"
{
  sw_vers 2>/dev/null
  xcodebuild -version 2>/dev/null || echo "xcodebuild: NON TROVATO — installare Xcode 16 o piu' recente"
  swift --version 2>/dev/null || echo "swift: NON TROVATO"
} 2>&1 | tee -a "$LOG"

VERSIONE_XCODE=$(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}' | cut -d. -f1)
if [ -n "${VERSIONE_XCODE:-}" ] && [ "$VERSIONE_XCODE" -lt 16 ] 2>/dev/null; then
  echo "ATTENZIONE: il progetto vuole Xcode 16 o piu' recente (cartelle sincronizzate)." | tee -a "$LOG"
  echo "            Se non si apre: brew install xcodegen && xcodegen generate" | tee -a "$LOG"
fi

# 2. La logica, senza aprire Xcode. Qui esce la maggior parte degli errori.
titolo "2. CarnetKit — compilazione"
( cd CarnetKit && swift build 2>&1 ) | tee -a "$LOG"
ESITO_BUILD=${PIPESTATUS[0]}

if [ "$ESITO_BUILD" -eq 0 ]; then
  titolo "3. CarnetKit — test"
  ( cd CarnetKit && swift test 2>&1 ) | tee -a "$LOG"
  ESITO_TEST=${PIPESTATUS[0]}
else
  titolo "3. CarnetKit — test"
  echo "Saltati: la logica non compila ancora. Prima gli errori qui sopra." | tee -a "$LOG"
  ESITO_TEST=1
fi

# 3. L'app. Sul simulatore e senza firma: gli errori di compilazione escono lo stesso,
#    e non serve ne' un team ne' un iPad collegato.
titolo "4. App CarnetMalin — compilazione (simulatore, senza firma)"
xcodebuild \
  -project CarnetMalin.xcodeproj \
  -scheme CarnetMalin \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build 2>&1 | tee -a "$LOG"
ESITO_APP=${PIPESTATUS[0]}

# 4. Il riassunto.
titolo "Riassunto"
ERRORI=$(grep -c "error:" "$LOG")
AVVISI=$(grep -c "warning:" "$LOG")

{
  echo "Logica (swift build) : $([ "$ESITO_BUILD" -eq 0 ] && echo OK || echo FALLITA)"
  echo "Test   (swift test)  : $([ "$ESITO_TEST" -eq 0 ] && echo OK || echo FALLITI)"
  echo "App    (xcodebuild)  : $([ "$ESITO_APP" -eq 0 ] && echo OK || echo FALLITA)"
  echo
  echo "Righe con error:   $ERRORI"
  echo "Righe con warning: $AVVISI"
} | tee -a "$LOG"

if [ "$ERRORI" -gt 0 ]; then
  printf '\n\033[1mI primi 20 errori\033[0m\n'
  grep "error:" "$LOG" | head -20
fi

# Il registro completo e quasi tutto righe di comando del compilatore. Questo tiene solo
# quello che serve: errori e avvisi, senza i codici colore.
BREVE="${LOG%.log}-errori.txt"
# $'...' perche il sed di macOS non conosce la scrittura esadecimale: la shell mette il carattere vero.
sed $'s/\x1b\\[[0-9;]*m//g' "$LOG" \
  | grep -E "error:|warning:|BUILD FAILED|Test Case .*failed|XCTAssert" \
  | grep -v "Failed frontend command" \
  | grep -v "SwiftCompile normal" \
  | sed "s|/Users/[^ ]*/Mon-Carnet-Malin/||g" \
  | sort -u > "$BREVE"

printf '\nRegistro completo : %s\n' "$LOG"
printf 'Solo gli errori   : %s\n' "$BREVE"
printf 'Il secondo basta: e molto piu corto.\n'

[ "$ESITO_BUILD" -eq 0 ] && [ "$ESITO_TEST" -eq 0 ] && [ "$ESITO_APP" -eq 0 ]
