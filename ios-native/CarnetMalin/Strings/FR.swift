import CarnetKit
import Foundation

/// Everything the app says, in French.
///
/// The app is French-only and the strings live here rather than in a `.strings` catalogue on purpose: there is one
/// language, and keeping the text next to nothing but itself makes it easy to read the whole voice of the app at
/// once and keep it consistent. They are ported from `client/src/i18n/fr/`, word for word, so a family moving
/// between the web app and this one reads the same sentences.
///
/// Two rules run through all of it. The app speaks to the child as « tu », plainly, in short sentences. And it never
/// names a condition: a setting is called after what it does — « Syllabes en couleurs », « Lettres muettes en
/// gris » — never after who it is for.
enum FR {
    static func format(_ template: String, _ values: [String: String]) -> String {
        var out = template
        for (key, value) in values { out = out.replacingOccurrences(of: "{\(key)}", with: value) }
        return out
    }

    /// A narrow no-break space, as French typography wants before « % », « ! », « ? » and « : ».
    static let narrowSpace = "\u{202F}"

    /// §29 « Ouvrir dans Carnet Malin ».
    enum Incoming {
        static let arrived = "Document reçu : il sera ajouté depuis l’espace des adultes."
        static let tooLarge = "Ce fichier est trop gros (30 Mo au maximum)."
        static let unreadable = "Ce fichier n’a pas pu être ouvert."
        static let title = "Document reçu"
        static let intro = "Un document a été ouvert dans Carnet Malin. Choisissez qui le lira, puis ajoutez-le."
        static let add = "Ajouter ce document"
        static let ignore = "Ne pas l’ajouter"
    }

    enum Common {
        static let back = "Retour"
        static let close = "Fermer"
        static let cancel = "Annuler"
        static let validate = "Valider"
        static let save = "Enregistrer"
        static let saved = "Enregistré"
        static let yes = "Oui"
        static let no = "Non"
        static let ok = "D’accord"
        static let proceed = "Continuer"
        static let next = "Suivant"
        static let previous = "Précédent"
        static let edit = "Modifier"
        static let delete = "Supprimer"
        static let retry = "Réessayer"
        static let done = "Terminé"
        static let loading = "Chargement…"
        static let pleaseWait = "Un instant…"
        static let offline = "Hors ligne"
        static let online = "En ligne"
        static let offlineHint = "Pas de connexion. Tu peux continuer à lire."
        static let genericError = "Oups, quelque chose n’a pas marché. Réessaie dans un instant."

        static let pinBackspace = "Effacer le dernier chiffre"
        static let pinSubmit = "Valider le code"

        static func percent(_ value: Int) -> String { "\(value)\(narrowSpace)%" }
    }

    enum Fonts {
        static let lexend = "Lexend"
        static let andika = "Andika"
        static let atkinson = "Atkinson Hyperlegible"
        static let opendyslexic = "OpenDyslexic"
        static let system = "Police de l’iPad"

        static func name(_ font: ReadingFontName) -> String {
            switch font {
            case .lexend: return lexend
            case .andika: return andika
            case .atkinson: return atkinson
            case .opendyslexic: return opendyslexic
            case .system: return system
            }
        }
    }

    enum Themes {
        static let creme = "Crème"
        static let clair = "Clair"
        static let sombre = "Sombre"
    }

    enum SignIn {
        static let title = "Carnet Malin"
        static let lead = "Connecte-toi pour retrouver tes livres."
        static let email = "Adresse e-mail"
        static let password = "Mot de passe"
        static let submit = "Se connecter"
        static let working = "Connexion…"
        static let serverTitle = "Adresse du serveur"
        static let serverHint = "L’adresse que l’adulte a installée à la maison."
        static let serverInvalid = "Cette adresse n’a pas l’air d’être une adresse Internet."
        static let wrongDetails = "L’adresse e-mail ou le mot de passe n’est pas le bon."
        static let locked = "Trop d’essais. Attends un moment avant de réessayer."
        static let offline = "Pas de connexion. Vérifie le Wi-Fi, puis réessaie."
        static let setupRequired = "Ce serveur n’a pas encore de compte. Un adulte doit d’abord en créer un dans le navigateur."
        static let signOut = "Se déconnecter"
        static let signOutConfirm = "Tu veux vraiment te déconnecter ? Tes livres resteront sur cet iPad."
        static let createAccount = "Créer un compte"
        static let firstInstall = "Première installation"
        static let setupRequiredHere =
            "Ce serveur n’a pas encore de compte. Un adulte peut le créer ici, avec « Première installation »."
        static let forgotPassword = "Mot de passe oublié ?"
    }

    /// Creating the account, addressed to the adult with « vous ».
    enum Account {
        static let setupTitle = "Bienvenue dans Carnet Malin"
        static let setupIntro = "Créez votre compte. Il protège les réglages et les livres de votre enfant."
        static let setupCode = "Code d’installation"
        static let setupCodeHint = "Le code défini sur le serveur (SETUP_TOKEN)."
        static let registerTitle = "Créer un compte"
        static let registerIntro =
            "Avec le code d’invitation reçu, créez votre compte. Il protège les réglages et les livres de vos enfants."
        static let inviteCode = "Code d’invitation"
        static let inviteCodeHint = "Le code transmis par la personne qui gère l’app, par exemple K7QM-3FXA-9TRD."
        static let name = "Votre prénom"
        static let email = "E-mail"
        static let password = "Mot de passe"
        static let passwordHint = "Au moins 10 caractères."
        static let passwordConfirm = "Confirmer le mot de passe"
        static let pin = "Code des réglages"
        static let pinHint = "6 chiffres recommandés. Il ouvre les réglages sur l’iPad."
        static let pinConfirm = "Confirmer le code des réglages"
        static let submit = "Créer le compte"
        static let working = "Création…"
        static let closed = "Les inscriptions ne sont pas ouvertes. Demandez un code d’invitation."
        static let offline = "Une connexion Internet est nécessaire pour créer un compte."

        static let resetTitle = "Mot de passe oublié"
        static let resetIntro = "Indiquez l’e-mail du compte. S’il existe, vous recevrez un lien valable 30 minutes."
        static let resetEmail = "E-mail du compte"
        static let resetSubmit = "Recevoir le lien"
        static let resetSent =
            "Si un compte utilise cette adresse, un e-mail vient de partir. Regardez aussi dans les courriers "
            + "indésirables. Le lien s’ouvre dans le navigateur ; le code des réglages vous sera demandé."
        static let resetUnavailable = "La récupération par e-mail n’est pas configurée sur ce serveur."
    }

    enum ChildSelect {
        static let title = "Qui lit aujourd’hui ?"
        static func choose(_ name: String) -> String { format("C’est moi, {prenom}", ["prenom": name]) }
        static let emptyTitle = "Pas encore de profil"
        static let emptyMessage = "Un adulte peut créer ton profil dans les réglages."
        static let emptyAction = "Réglages"
    }

    enum Home {
        static func greeting(_ name: String) -> String { format("Bonjour {prenom} !", ["prenom": name]) }
        static let greetingNoName = "Bonjour !"
        static let books = "Mes livres"
        static let continueReading = "Continuer la lecture"
        static let exercises = "Exercices"
        static let notes = "Mes notes"
        static let question = "Pose ta question"
        static let questionOffline = "Il faut Internet"
        static func continuePage(_ page: Int) -> String { format("Page {page}", ["page": String(page)]) }
        static let continueNone = "Choisis un livre"
        static let parentAccess = "Réglages"
        static let switchChild = "Changer de lecteur"
    }

    enum Library {
        static let title = "Mes livres"
        static let back = "Accueil"
        static func lastPage(_ page: Int) -> String { format("Page {page}", ["page": String(page)]) }
        static func pageCount(_ count: Int) -> String {
            count == 1 ? "1 page" : format("{count} pages", ["count": String(count)])
        }
        static let notStarted = "Pas encore commencé"
        static let preparing = "Préparation"
        static func readyPages(ready: Int, total: Int) -> String {
            format("Pages prêtes : {ready} sur {total}", ["ready": String(ready), "total": String(total)])
        }
        static let emptyTitle = "Pas encore de livre"
        static let emptyMessage = "Demande à un adulte d’ajouter un livre."
        static let untitled = "Livre sans titre"
        static let homework = "Devoirs"
        static let homeworkDone = "J’ai terminé"
    }

    enum Reader {
        static let loading = "J’ouvre ton livre…"
        static let quoteNotFound = "Je n’ai pas retrouvé ce passage exact, mais tu es sur la bonne page."
        static let notFoundTitle = "Je ne trouve pas ce livre"
        static let notFoundMessage = "Il n’est pas sur cet iPad pour le moment."
        static let notFoundAction = "Mes livres"

        static let back = "Retour à mes livres"
        static func pageOf(current: Int, total: Int) -> String {
            format("Page {current} / {total}", ["current": String(current), "total": String(total)])
        }
        static let modeLabel = "Mode du lecteur"
        static let modeReading = "Lecture"
        static let modeAnnotation = "Annotation"
        static let settings = "Réglages de lecture"
        static let listen = "Écouter le texte"
        static let listenClose = "Fermer la lecture à voix haute"
        static let menu = "Plus d’options"

        static let menuQuestion = "Une question sur le texte"
        static let menuExercises = "Exercices"
        static let menuSummary = "Résumé"
        static let menuShowOriginal = "Voir la page originale"
        static let menuShowText = "Voir le texte"

        static let previousPage = "Page précédente"
        static let nextPage = "Page suivante"

        static func pageLabel(_ page: Int) -> String { format("Page {page}", ["page": String(page)]) }
        static let pageNotReady = "Cette page se prépare. Tu peux lire les autres pages."
        static let pageNoText = "Il n’y a pas de texte sur cette page."
        static let pageLowConfidence = "Cette page a été lue par la machine : il peut y avoir des erreurs."

        static let originalTitle = "Page originale"
        static let originalUnavailable = "Image non disponible sur cet appareil"
        static let zoomIn = "Agrandir"
        static let zoomOut = "Rétrécir"
        static let zoomReset = "Taille normale"

        static let selectionLabel = "Que veux-tu faire avec ce texte ?"
        static let selectionRead = "Lire"
        static let selectionDefinition = "Définition"
        static let selectionExplain = "Explique"
        static let selectionSimplify = "Simplifie"
        static let selectionHighlight = "Surligner"
        static let selectionUnhighlight = "Enlever"
        static let selectionPreviousWord = "Mot précédent"
        static let selectionNextWord = "Mot suivant"
        static let selectionSentence = "Toute la phrase"
        static let selectionParagraph = "Tout le paragraphe"
        static let selectionTooLong = "C’est un peu long. Choisis un morceau plus petit."
        static let highlighted = "C’est surligné !"
        static let unhighlighted = "Le surlignage est enlevé."

        static let guideHandle = "Règle de lecture : fais glisser pour la déplacer"

        static let settingsTitle = "Réglages de lecture"
        static let settingsPreview = "Le petit renard lit un livre sous le grand arbre."
        static let sectionText = "Le texte"
        static let sectionSpace = "Les espaces"
        static let sectionDisplay = "L’affichage"
        static let sectionVoice = "La voix"
        static let font = "Police"
        static let fontSize = "Taille des lettres"
        static let lineHeight = "Espace entre les lignes"
        static let letterSpacing = "Espace entre les lettres"
        static let wordSpacing = "Espace entre les mots"
        static let columnWidth = "Largeur du texte"
        static let theme = "Couleur du fond"
        static let layout = "Façon de lire"
        static let layoutPage = "Page par page"
        static let layoutContinuous = "Texte continu"
        static let sentenceHighlight = "Montrer la phrase lue"
        static let sentenceHighlightHint = "La phrase lue à voix haute est colorée."
        static let readingGuide = "Règle de lecture"
        static let readingGuideHint = "Une bande t’aide à suivre la ligne."
        static let rate = "Vitesse de la voix"
        static let voice = "Voix de cet appareil"
        static let voiceTest = "Écouter la voix"
        static let reset = "Revenir aux réglages de départ"
    }

    enum Aids {
        static let title = "Couleurs de lecture"
        static let hint = "Des couleurs sur les lettres aident à découper les mots. Le texte ne change pas."
        static let syllables = "Syllabes en couleurs"
        static let syllablesHint = "Une syllabe bleue, une syllabe rouge : pa|pil|lon."
        static let silentLetters = "Lettres muettes en gris"
        static let silentLettersHint = "Les lettres qu’on écrit mais qu’on n’entend pas sont plus claires."
        static let sounds = "Sons de plusieurs lettres"
        static let soundsHint = "Les lettres qui font un seul son ensemble (ou, an, ch, eau…) sont sur un fond vert."
        static let changedLetters = "Lettres qui changent de son"
        static let changedLettersHint = "Soulignées : le c qui fait « s », le g qui fait « j », le s qui fait « z »…"
        static let liaisons = "Liaisons"
        static let liaisonsHint = "Un petit pont relie les mots qu’on lie en lisant : les‿amis."
        static let preview = "Les enfants ont trouvé un petit oiseau dans la maison."
    }

    enum TTS {
        static let barLabel = "Lecture à voix haute"
        static let play = "Lire à voix haute"
        static let resume = "Reprendre la lecture"
        static let pause = "Mettre en pause"
        static let stop = "Arrêter la lecture"
        static let previous = "Phrase précédente"
        static let next = "Phrase suivante"
        static let close = "Fermer la lecture à voix haute"
        static let rate = "Vitesse"
        static let slower = "Lire plus lentement"
        static let faster = "Lire plus vite"
        static let nothingToRead = "Il n’y a encore rien à lire ici."
        static let startFailed = "La voix ne démarre pas. Réessaie dans un instant."

        /// §22 « Préparer la lecture »: the home computer punctuates the page for the voice. The text does not change.
        enum Prepare {
            static let button = "Préparer la lecture"
            static let hint = "La voix fera mieux les pauses, par exemple après « 1 : ». Le texte ne change pas."
            static let busy = "Préparation…"
            static let done = "Lecture préparée"
            static let queued = "La lecture de cette page se prépare. La voix l’utilisera dès qu’elle sera prête."
            static let already = "La lecture de cette page est déjà en préparation."
            static let ready = "La lecture est prête : la voix fera mieux les pauses."
            static let later = "Pas encore prête : l’ordinateur de la maison la préparera dès que possible."
            static let unavailable = "Cette aide n’est pas disponible pour le moment."
            static let offline = "Il faut Internet pour préparer la lecture."
            static let failed = "La préparation n’a pas pu démarrer. Réessaie dans un instant."
        }
        static let voiceAutomatic = "Voix automatique"
        static let voiceNone = "Aucune voix française sur cet appareil."
        static let sentencePause = "Pause entre les phrases"
        static let paragraphPause = "Pause entre les paragraphes"
        static func seconds(_ value: Double) -> String {
            format("{value} s", ["value": String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",")])
        }

        /// The voices worth having are free and already on the iPad; they just have to be downloaded once.
        static let betterVoiceTitle = "Une voix plus naturelle"
        static let betterVoiceIntro =
            "Les voix « Premium » ou « Améliorées » de l’iPad lisent avec une vraie intonation. Elles sont gratuites :"
        static let betterVoiceSteps = [
            "Ouvrez les Réglages de l’iPad.",
            "Accessibilité → Contenu énoncé → Voix → Français.",
            "Choisissez une voix marquée « Premium » ou « Améliorée » (par exemple Audrey ou Thomas) et touchez le "
                + "bouton de téléchargement.",
            "Quand le téléchargement est terminé, fermez l’app et rouvrez-la.",
        ]
    }

    enum Pencil {
        static let title = "Crayons"
        static let pencil = "Crayon"
        static let pen = "Stylo"
        static let highlighter = "Surligneur"
        static let eraser = "Gomme"
        static let eraserStroke = "Effacer un trait entier"
        static let eraserPartial = "Effacer un morceau"
        static let eraserPage = "Tout effacer sur cette page"
        static let eraserPageConfirm = "Effacer tous tes dessins de cette page ?"
        static let undo = "Annuler"
        static let redo = "Refaire"
        static let colour = "Couleur"
        static let thickness = "Épaisseur"
        static let thicknessFine = "Fin"
        static let thicknessMedium = "Moyen"
        static let thicknessThick = "Épais"
        static let fingerDraws = "Dessiner avec le doigt"
        static let fingerDrawsHint = "Sans Apple Pencil, le doigt dessine. Sinon, le doigt fait défiler la page."
    }

    enum Notes {
        static let title = "Mes notes"
        static let back = "Accueil"
        static let openBook = "Ouvrir le livre"
        static func page(_ page: Int) -> String { format("Page {page}", ["page": String(page)]) }
        static let highlights = "Ce que j’ai surligné"
        static func drawings(_ count: Int) -> String {
            count == 1 ? "1 dessin ou note écrite" : format("{count} dessins ou notes écrites", ["count": String(count)])
        }
        static let answers = "Mes réponses écrites"
        static let drawnAnswer = "Réponse dessinée"
        static let openQuiz = "Revoir l’exercice"
        static func openAtPage(_ page: Int) -> String { format("Ouvrir à la page {page}", ["page": String(page)]) }
        static let detachedDrawing = "Dessin sur le texte"
        static let detached = "Note détachée du texte"
        static let detachedHint = "Le texte de la page a changé : cette note n’a plus de place."
        static let emptyTitle = "Pas encore de note"
        static let emptyMessage = "Surligne ou écris dans un livre : tes notes seront ici."
    }

    enum Exercises {
        static let title = "Exercices"
        static func questionOf(current: Int, total: Int) -> String {
            format("Question {current} sur {total}", ["current": String(current), "total": String(total)])
        }
        static let check = "Vérifier"
        static let nextQuestion = "Question suivante"
        static let finish = "J’ai fini"
        static let trueAnswer = "Vrai"
        static let falseAnswer = "Faux"
        static let writeHere = "Écris ta réponse ici"
        static let drawAnswer = "Écrire à la main"
        static let reread = "Relire le passage"
        static let typeAnswer = "Taper la réponse"
        static let orderHint = "Fais glisser les phrases pour les remettre dans l’ordre."
        static let matchHint = "Relie chaque mot à ce qui va avec."
        static let readPassage = "Relire le passage"
        static let waitingForCorrection = "Je regarde ta réponse…"
        static let freeAnswerOffline =
            "Je ne peux pas encore corriger cette réponse : il faut Internet. Elle est gardée, tu pourras la revoir."
        static let emptyTitle = "Pas encore d’exercice"
        static let emptyMessage = "Ouvre un livre : tu pourras faire des exercices sur ce que tu as lu."
        static func score(correct: Int, total: Int) -> String {
            format("{correct} sur {total}", ["correct": String(correct), "total": String(total)])
        }
        static let wellDoneTitle = "C’est fini !"
    }

    /// The sync, table by table, for the adult.
    enum SyncDetail {
        static let pendingTitle = "En attente par type"
        static func table(_ table: SyncTable) -> String {
            switch table {
            case .children: return "Profils"
            case .documents: return "Livres"
            case .pages: return "Pages"
            case .annotations: return "Annotations"
            case .progress: return "Progression de lecture"
            case .sessions: return "Séances de lecture"
            case .exercises: return "Exercices"
            case .answers: return "Réponses"
            }
        }
        static let annotationsDisabled =
            "La synchronisation des annotations est désactivée : elles restent sur cet iPad."
        static let rejectedTitle = "Refusés par le serveur"
        static let rejectedHint = "La version du serveur a été conservée."
        static func reason(_ reason: SyncRejectionReason) -> String {
            switch reason {
            case .parentLocked: return "réglages verrouillés"
            case .forbidden: return "non autorisé"
            case .invalid: return "données non valides"
            case .stale: return "version plus récente sur le serveur"
            }
        }
    }

    enum Parent {
        static let title = "Réglages"
        static let gateTitle = "Espace des adultes"
        static let gateLead = "Entre le code à 4 chiffres."
        static let gateWrong = "Ce code n’est pas le bon."
        static func gateLocked(_ minutes: Int) -> String {
            format("Trop d’essais. Réessayez dans {minutes} min.", ["minutes": String(minutes)])
        }
        static let gateForgot = "Code oublié ?"
        static let gateForgotHint = "Le code se change depuis un navigateur, avec le mot de passe du compte."

        static let children = "Les lecteurs"
        static let addChild = "Ajouter un lecteur"
        static let books = "Les livres"
        static let addBook = "Ajouter un livre"
        static let scanPages = "Scanner des pages"
        static let importFile = "Choisir un fichier"
        static let importing = "Import en cours…"
        static let importPagesReady = "Pages lues : {ready} sur {total}"
        static let toCheck = "À vérifier"
        static let toCheckHint = "Ces pages ont été lues par la machine. Jetez-y un œil avant que l’enfant les lise."
        static let account = "Le compte"
        static let devices = "Appareils connectés"
        static let sync = "Synchronisation"
        static let syncNow = "Synchroniser maintenant"
        static func syncLast(_ when: String) -> String {
            format("Dernière synchronisation : {when}", ["when": when])
        }
        static let syncNever = "Jamais synchronisé"
        static let syncPending = "{count} changements en attente"
        static let syncOffline = "Hors ligne. Les changements partiront au retour du réseau."

        static let childName = "Prénom"
        static let childAge = "Âge"
        static let childAvatar = "Image"
        static let readingLevel = "Niveau de lecture"
        static let readingLevelBeginner = "Débutant"
        static let readingLevelIntermediate = "Moyen"
        static let readingLevelAdvanced = "À l’aise"
        static let explanationDifficulty = "Façon d’expliquer"
        static let explanationVerySimple = "Très simple"
        static let explanationSimple = "Simple"
        static let explanationNormal = "Normale"
        static let exerciseCount = "Nombre de questions"
        static let exerciseTypes = "Types de questions"
        static let questionTypeMultipleChoice = "Choisir la bonne réponse"
        static let questionTypeTrueOrFalse = "Vrai ou faux"
        static let questionTypeFreeAnswer = "Répondre avec ses mots"
        static let questionTypeMatching = "Relier"
        static let questionTypeOrdering = "Remettre dans l’ordre"
        static let deleteChild = "Supprimer ce lecteur"
        static let deleteChildConfirm =
            "Supprimer ce lecteur ? Ses livres restent, mais ses notes et ses réponses seront effacées."
    }

    /// Définition, explication, texte plus simple, question sur le texte. Ported from `help.ts`.
    enum Help {
        static let definitionTitle = "Définition"
        static let explainTitle = "Explication"
        static let simplifyTitle = "Plus simple"
        static let questionTitle = "Une question sur le texte"
        static let definitionLoading = "Je cherche ce mot…"
        static let explainLoading = "Je réfléchis pour t’aider…"
        static let simplifyLoading = "Je rends le texte plus simple…"
        static let questionLoading = "Je cherche dans le texte…"
        static let selectedText = "Tu as choisi :"
        static let listen = "Écouter"
        static let listenLabel = "Écouter la réponse"
        static let example = "Exemple"
        static let askExplain = "Demander une explication"
        static let retry = "Réessayer"
        static func seeInText(_ page: Int) -> String { format("Voir dans le texte · page {page}", ["page": String(page)]) }
        static let questionIntro = "Pose une seule question sur ce livre. Je cherche la réponse dans le texte."
        static let questionLabel = "Ta question"
        static let questionPlaceholder = "Par exemple : où se passe l’histoire ?"
        static let questionSubmit = "Poser ma question"
        static let questionEmpty = "Écris d’abord ta question."
        static let questionAnother = "Poser une autre question"
        static let questionNoText = "Les pages de ce livre ne sont pas encore prêtes."
        static func counter(_ count: Int, _ max: Int) -> String { "\(count) / \(max)" }
    }

    /// « Pose ta question ». Ported from `question.ts`.
    enum FreeQuestion {
        static let title = "Pose ta question"
        static let back = "Accueil"
        static let label = "Ta question"
        static let hint = "Écris-la, ou parle avec le micro du clavier."
        static let placeholder = "Par exemple : pourquoi le ciel est bleu ?"
        static let tooLong = "Ta question est un peu longue. Essaie de la raccourcir."
        static let submit = "Demander"
        static let offline = "Il faut Internet pour poser une question. Tu peux lire tes livres en attendant."
        static let waitingNormal = "Je réfléchis…"
        static let waitingSimpler = "Je cherche une façon plus simple de t’expliquer…"
        static let stop = "Arrêter"
        static let answerTitle = "Voici la réponse"
        static let yourQuestion = "Ta question :"
        static let example = "Exemple :"
        static let notUnderstood = "Je n’ai pas compris"
        static let suggestionsTitle = "Tu veux savoir autre chose ?"
        static let newQuestion = "Nouvelle question"
        static let retry = "Réessayer"
        static let disabledTitle = "Pas de questions pour le moment"
        static let disabledMessage = "Si tu te demandes quelque chose, demande à un adulte."
    }

    /// Le résumé. Ported from `exercises.ts` › summary.
    enum Summary {
        static let title = "Résumé"
        static let levelLabel = "Quelle taille de résumé ?"
        static let levelShort = "Bref"
        static let levelNormal = "Normal"
        static let levelDetailed = "Détaillé"
        static let start = "Faire le résumé"
        static let preparing = "Je prépare le résumé…"
        static func progress(_ done: Int, _ total: Int) -> String { "\(done)/\(total)" }
        static let resultTitle = "Le résumé"
        static let listen = "Écouter le résumé"
        static let keyPointsTitle = "Les points importants"
        static let sourcesTitle = "Où le trouver dans le livre ?"
        static func openSource(_ page: Int) -> String { format("Relire à la page {page}", ["page": String(page)]) }
        static let again = "Faire un autre résumé"
        static let blockedTitle = "Pas de résumé pour ce passage"
        static let unavailableTitle = "Pas de résumé pour le moment"
        static let emptyText = "Je n’ai pas trouvé assez de texte pour faire un résumé."
        static let pagesLabel = "Quelles pages ?"
        static let pagesAll = "Tout le livre"
        static let pagesCurrent = "Cette page"
        static func pagesRange(_ from: Int, _ to: Int) -> String {
            from == to ? format("Page {a}", ["a": String(from)])
                : format("Pages {a} à {b}", ["a": String(from), "b": String(to)])
        }
    }

    /// Préparer des questions. Ported from `exercises.ts` › setup.
    enum ExerciseSetup {
        static let title = "Fais-moi des questions"
        static let countLabel = "Combien de questions ?"
        static let typesLabel = "Quels types de questions ?"
        static let typesHint = "Touche un type pour l’enlever ou le remettre."
        static let start = "C’est parti !"
        static let waitingTitle = "Je prépare tes questions…"
        static let waitingSteps = [
            "Je lis les pages…",
            "Je cherche les passages importants…",
            "J’écris les questions…",
            "Encore un petit moment…",
        ]
        static let stop = "Arrêter"
        static let blockedTitle = "Pas de questions pour ce passage"
        static let unavailableTitle = "Les questions ne sont pas disponibles pour le moment"
        static let emptyTitle = "Pas de questions cette fois"
        static let emptyText =
            "Je n’ai pas réussi à préparer des questions sur ces pages. Essaie avec d’autres pages."
        static let retry = "Réessayer"
        static let noneReady = "Ces pages ne sont pas encore prêtes."
        static let create = "Créer des questions"
        static let feedbackSelfCheck = "Compare avec la réponse attendue"
        static let expected = "Réponse attendue :"
        static let keyPoints = "Les idées importantes :"
        static let checking = "Je regarde ta réponse…"
    }

    /// Livres et documents, in the adult area. Ported from `documents.ts`.
    enum Documents {
        static let title = "Livres et documents"
        static let intro = "Les pages deviennent lisibles une par une, dès qu’elles sont prêtes."
        static let emptyTitle = "Aucun document"
        static let emptyMessage = "Importez un PDF, un livre EPUB ou prenez des pages en photo."
        static let noChild = "Aucun enfant"
        static func confirmDelete(_ title: String) -> String { format("Supprimer « {title} » ?", ["title": title]) }
        static let confirmMessage =
            "Le document, ses pages et les notes des enfants sur ce document seront supprimés."
        static let delete = "Supprimer"
        static let deleted = "Document supprimé."
        static let deleteFailed = "La suppression n’a pas abouti. Réessayez."
        static let homeworkTodo = "Devoir à faire"
        static func summary(ready: Int, toCheck: Int, total: Int) -> String {
            format("{ready} prête(s) · {toCheck} à vérifier · {total} au total",
                   ["ready": String(ready), "toCheck": String(toCheck), "total": String(total)])
        }
        static let titleLabel = "Titre"
        static let readers = "Pour qui ?"
        static let pagesTitle = "Les pages"
        static let filterAll = "Toutes"
        static func filterDoubtful(_ count: Int) -> String { format("À vérifier ({count})", ["count": String(count)]) }
        static let emptyDoubtful = "Aucune page à vérifier."

        static func status(_ status: PageStatus) -> String {
            switch status {
            case .pending: return "En attente"
            case .processing: return "Lecture en cours"
            case .ready: return "Prête"
            case .lowConfidence: return "À vérifier"
            case .failed: return "Échec"
            }
        }
        static let awaitingAi = "Lecture intelligente en attente"

        static func source(_ source: PageTextSource) -> String {
            switch source {
            case .pdfText: return "Texte du PDF"
            case .ocrLocal: return "Lu sur cet appareil"
            case .ocrServer: return "Lu par le serveur"
            case .manual: return "Corrigé à la main"
            case .epubText: return "Texte du livre numérique"
            case .ocrAi: return "Lecture intelligente"
            }
        }

        static let textModeLabel = "Type de document"
        static let textModeFaithful = "Livre ou document imprimé"
        static let textModePunctuated = "Texte écrit par un enfant"
        static let textModeFaithfulHint = "Le texte est gardé tel qu’il est imprimé."
        static let textModePunctuatedHint =
            "Rédaction, dictée, cahier… La lecture intelligente garde tous les mots de l’enfant, fautes comprises, "
            + "et remet seulement la ponctuation et les majuscules, pour une lecture à voix haute naturelle."
        static let textModeSaved = "Type de document enregistré."
        static let textModeOffline = "Changer le type de document demande une connexion."

        static let relaunchAi = "Relancer la lecture intelligente"
        static func relaunchAiDone(_ count: Int) -> String {
            count == 1 ? "1 page envoyée à la lecture intelligente."
                : format("{count} pages envoyées à la lecture intelligente.", ["count": String(count)])
        }
        static let relaunchAiNone =
            "Aucune page à envoyer : elles sont déjà en attente, déjà lues, ou leurs images ne sont pas encore sur le serveur."

        static let prepare = "Préparer la lecture à voix haute"
        static let prepareHint =
            "L’ordinateur de la maison ajoute les pauses pour la voix (après « 1 : », à la fin des consignes…). "
            + "Le texte affiché ne change pas."
        static func prepareDone(_ count: Int) -> String {
            count == 1 ? "1 page envoyée à l’ordinateur de la maison."
                : format("{count} pages envoyées à l’ordinateur de la maison.", ["count": String(count)])
        }
        static let prepareNone = "Aucune page à préparer : elles sont déjà prêtes ou en attente."
        static func prepareUnavailable(_ reason: ReadingPreparationUnavailable) -> String {
            switch reason {
            case .notConfigured: return "L’ordinateur de la maison n’est pas configuré sur votre serveur."
            case .aiDisabled: return "L’aide intelligente est désactivée dans Options."
            case .textNotSynced:
                return "Activez la synchronisation du texte des documents dans Options : l’ordinateur de la maison en a besoin."
            }
        }
        static let needsConnection = "Cette action demande une connexion."
        static let parentLocked = "L’espace des adultes s’est refermé. Rouvrez-le pour continuer."
    }

    enum Errors {
        static let offline = "Pas de connexion pour le moment."
        static let sessionExpired = "La session a expiré. Reconnecte-toi."
        static let serverBusy = "Le serveur est occupé. Réessaie dans un instant."
        static let notFound = "Je ne trouve pas ça."

        /// The message a child should see for an error the app could not name.
        static func message(for error: Error) -> String {
            guard let apiError = error as? APIError else { return Common.genericError }
            switch apiError {
            case .offline, .timedOut: return offline
            case .notAuthenticated: return sessionExpired
            case let .api(status, _, message):
                if status == 401 { return sessionExpired }
                if status == 404 { return notFound }
                if status == 429 || status >= 500 { return serverBusy }
                // The server already writes its messages for a child; there is no better wording to invent here.
                return message.isEmpty ? Common.genericError : message
            case .invalidResponse: return Common.genericError
            }
        }
    }
}

/// The reading fonts, named as the app names them.
enum ReadingFontName {
    case lexend, andika, atkinson, opendyslexic, system

    init(_ font: ReadingFont) {
        switch font {
        case .lexend: self = .lexend
        case .andika: self = .andika
        case .atkinson: self = .atkinson
        case .opendyslexic: self = .opendyslexic
        case .systeme: self = .system
        }
    }
}
