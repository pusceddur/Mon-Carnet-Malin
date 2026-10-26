# App Store Connect — ce qu'il faut saisir

Ce que l'app native (`ios-native/`) demande dans App Store Connect, réponse par réponse. Les réponses suivent ce que
fait le code au 2026-10-24. Si une fonction change ce qui sort de l'appareil, ce fichier, `CarnetMalin/PrivacyInfo.xcprivacy`
et la page `/confidentialite` (`server/src/legal/privacyPolicy.fr.ts`) changent ensemble.

## Avant la première archive

- [ ] `Support/Server.xcconfig` : décommenter les deux lignes PRODUCTION et y mettre le vrai domaine. L'étape
      « Check the server address » fait échouer toute archive (Product › Archive) si l'adresse est vide, encore
      `example.org`, ou pas en `https`.
- [ ] Sur le serveur de production, remplir `LEGAL_OPERATOR`, `LEGAL_CONTACT`, `LEGAL_HOSTING` et
      `LEGAL_AI_PROVIDERS` (voir `server/.env.example`). Tant qu'il en manque un, la page `/confidentialite` affiche
      « [à compléter par l'exploitant] » en jaune. Apple la lit pendant la revue.
- [ ] Signing & Capabilities : choisir l'équipe (compte Apple Developer payant). Xcode écrit alors `DEVELOPMENT_TEAM`
      dans le `.pbxproj` : ne pas le committer, le repo est public.
- [ ] Essayer sur un vrai iPad : scanner, OCR sur de vraies pages, « Ouvrir dans… » depuis Mail et Fichiers.

## Fiche de l'app

| Champ | Valeur |
|---|---|
| Catégorie principale | **Éducation** |
| Catégorie secondaire | Livres (facultatif) |
| Catégorie Kids | **Non.** L'app est pour tous les âges, et le compte est toujours celui d'un adulte. |
| URL de la politique de confidentialité | `https://<domaine>/confidentialite` |
| Bundle ID | `org.carnetmalin.app` |
| Appareils | iPad et iPhone (`TARGETED_DEVICE_FAMILY = 1,2`). Pour l'iPad seulement, mettre `2` : Apple ne demandera alors plus de captures iPhone et ne testera plus sur iPhone. |

**À éviter dans le nom, le sous-titre, les mots-clés et la description** : « pour enfants », « for kids », « for
children ». La règle 1.3 réserve ces mots aux apps de la catégorie Kids, et une app hors Kids qui les emploie est
refusée. On peut écrire « pour apprendre à lire », « lecture accompagnée », « devoirs ». On ne nomme pas non plus
de trouble (« dyslexie ») dans les métadonnées. C'est la règle de l'app (FR.swift), et cela éviterait aussi qu'Apple
la lise comme une app de santé.

## Classification par âge

Répondre « Aucun » à toutes les questions de contenu (violence, contenu sexuel, jeux d'argent…). Points à
surveiller :

- **Contenu généré par les utilisateurs ou communication entre utilisateurs** : non. Chaque famille ne voit que
  ses données.
- **Navigation Web sans restriction** : non. L'app n'a pas de navigateur intégré. Le seul lien externe est la
  politique de confidentialité, et il s'ouvre dans Safari.
- **Contenu généré par IA / assistant conversationnel** (si le questionnaire le demande) : **oui**. La « question
  libre » et les explications sont rédigées par une IA. Préciser qu'un filtre de sécurité côté serveur
  (`server/src/safety/`) les vérifie, et que l'adulte peut tout couper dans les réglages.
- **Contrôles parentaux** : oui. L'espace parent est protégé par un code, et l'adulte règle chaque aide.

Le résultat attendu est 4+ ou 9+, selon la réponse sur l'IA.

## Confidentialité de l'app (étiquettes « App Privacy »)

**Suivi (tracking)** : **Non**, pour tout. Pas d'IDFA, pas de SDK tiers, pas de publicité. `Package.swift` n'a aucune
dépendance.

**Données collectées** : oui. Pour chaque type ci-dessous, cocher :
- Finalité : **Fonctionnalités de l'app** uniquement. Ni analytique, ni publicité, ni personnalisation de produit.
- Liée à l'identité : **Oui**, car tout est rattaché au compte de l'adulte.
- Utilisée pour le suivi : **Non**.

| Catégorie Apple | Type | D'où ça vient dans le code |
|---|---|---|
| Coordonnées | Adresse e-mail | identifiant de connexion (`users.email`) |
| Coordonnées | Nom | nom affiché de l'adulte (`users.display_name`) |
| Identifiants | Identifiant utilisateur | identifiant du compte côté serveur, derrière le jeton de session |
| Contenu utilisateur | Photos ou vidéos | photos des pages, et image d'une réponse manuscrite si la reconnaissance est activée |
| Contenu utilisateur | Autre contenu utilisateur | livres, texte des pages, notes, dessins, devoirs, réponses, questions libres, textes corrigés, surnom du lecteur |
| Utilisation | Interactions avec le produit | progression et séances de lecture (`reading_progress`, `reading_sessions`) |
| Diagnostics | Autres données de diagnostic | `client_diagnostics` : type d'erreur, versions, modèle, mémoire. Jamais de texte. |

**Ne pas cocher** :
- Données de plantage. L'app n'envoie aucun rapport de crash.
- Données de performance.
- Localisation, contacts, santé, données financières, historique de navigation ou de recherche.
- Identifiant d'appareil. `DeviceInfo.swift` n'en envoie aucun.
- Audio. La voix est produite sur l'appareil, et l'app ne fait aucun enregistrement.

Ces réponses correspondent une à une au fichier `PrivacyInfo.xcprivacy`. Une étiquette qui contredit le manifeste
entraîne un refus.

**Partenaires tiers.** Apple compte comme « collectées » aussi les données que reçoivent les services d'IA. Elles
y figurent déjà, sous « Contenu utilisateur » et « Fonctionnalités de l'app ». Ce n'est pas du suivi.

## Notes pour la revue Apple

Les inscriptions se font sur invitation, et Apple ne peut pas créer de compte seul. Dans App Review Information :

- **Compte de démonstration** : un compte adulte déjà rempli, avec un lecteur et un livre. Donner l'e-mail, le mot
  de passe et le **code de l'espace parent**.
- **Notes**, à adapter :
  > Carnet Malin aide à lire : le texte d'un livre photographié est réaffiché avec la police, les espacements et les
  > aides choisis par un adulte (syllabes en couleurs, lecture à voix haute, explications). Les comptes sont créés
  > sur invitation ; utilisez le compte de démonstration ci-dessus. L'espace parent (icône réglages) demande le code
  > indiqué. Suppression du compte : espace parent › Compte › Supprimer le compte. La caméra sert uniquement à
  > photographier les pages.
- Le serveur doit être joignable pendant toute la revue, et l'IA aussi (voir la note sur l'IA 2 plus bas). Sinon
  les explications se replient sur la version locale, et la « question sur le texte » échoue sous les yeux du
  testeur.

Une app réservée à des invités peut aussi être refusée comme « app destinée à un public restreint ». Si cela arrive,
deux options : ouvrir les inscriptions, ou passer par la distribution privée (Custom App, TestFlight).

## Achat intégré (quand l'app deviendra payante)

Rien à faire aujourd'hui : l'app ne vend rien, et le mot « abonnement » qu'elle affiche désigne celui de l'IA de
l'ordinateur de la maison. Le jour où l'accès sera payant, la règle 3.1.1 rend l'achat intégré **obligatoire dans
l'app** :

1. **App Store Connect** : créer un groupe d'abonnements, avec par exemple un abonnement mensuel et un annuel
   (abonnements auto-renouvelables). Remplir le contrat « Paid Apps », les informations bancaires et fiscales.
   Le Small Business Program fait passer la commission de 30 % à 15 %.
2. **App** : écran d'abonnement en StoreKit 2 (`Product.products(for:)`, `purchase()`,
   `Transaction.currentEntitlements`), placé dans l'espace parent derrière le code. Il faut un bouton « Restaurer
   les achats », le prix et la durée affichés, et les liens vers les conditions et la politique de confidentialité.
3. **Serveur** : c'est lui qui décide de l'accès, pas l'app. Il faut une route qui reçoit la transaction signée
   (JWS), la vérifie avec l'App Store Server API, et rattache l'abonnement au compte (`appAccountToken` = id du
   compte). Il faut aussi une route pour les App Store Server Notifications V2 (renouvellement, remboursement,
   expiration).
4. **Web** : on peut vendre aussi sur le site, et un abonné web peut utiliser l'app (règle 3.1.3(b), services
   multiplateformes), **à condition que l'achat intégré soit aussi proposé dans l'app**. L'app ne doit contenir aucun
   lien ni aucun texte qui envoie vers un paiement en dehors de l'App Store. Seule exception : la vitrine des
   États-Unis, où les liens externes sont permis depuis 2025.
5. Mettre à jour la politique de confidentialité (paiement géré par Apple, aucune donnée bancaire reçue) et la
   fiche App Privacy (Achats › Historique d'achats).

## Note sur l'IA 2 (abonnement Claude sur le mini PC)

Un abonnement Claude grand public (Pro ou Max) est prévu pour un usage personnel. S'en servir pour répondre aux
utilisateurs d'une app publiée peut aller contre ses conditions d'utilisation, et le compte peut alors être
suspendu sans préavis. Avant la sortie, vérifier les conditions actuelles d'Anthropic. Pour un service ouvert à
d'autres familles, la voie prévue est l'API (clé API, facturation à l'usage).
