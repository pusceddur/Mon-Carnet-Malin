import CarnetKit
import Foundation

/// The adult area's own words. Ported from `client/src/i18n/fr/parent.ts` (sections `ai` and `activity`).
///
/// Addressed to the parent with « vous », where the rest of the app speaks to the child with « tu ».
extension FR {
    enum Activity {
        static let title = "Activité"
        static let child = "Enfant"
        static let allChildren = "Tous les enfants"
        static let period = "Période"
        static let periodWeek = "7 jours"
        static let periodMonth = "30 jours"
        static let readingTime = "Temps de lecture"
        static let pages = "Pages lues"
        static let words = "Mots cherchés"
        static let listening = "Temps d’écoute"
        static let sessions = "Séances"
        static let aiTitle = "Demandes d’aide intelligente"
        static func aiTotal(_ count: Int) -> String { format("{count} demandes", ["count": String(count)]) }
        static func cacheHits(_ count: Int) -> String {
            format("dont {count} déjà connues (gratuites)", ["count": String(count)])
        }
        static let aiNone = "Aucune demande sur la période."
        static let budgetTitle = "Budget du mois"
        static func budgetValue(spent: String, budget: String) -> String {
            format("{spent} sur {budget}", ["spent": spent, "budget": budget])
        }
        static let budgetWarning = "Le budget est presque atteint."
        static let budgetReached = "Budget atteint : l’aide intelligente est en pause."
        static func budgetEstimate(_ amount: String) -> String {
            format("Dont {amount} estimés pour l’ordinateur de la maison (abonnement).", ["amount": amount])
        }
        static let alertsTitle = "Alertes"
        static let alertsNone = "Aucune alerte."
        static let markSeen = "Marquer comme vu"
        static let seen = "Vu"
        static func alertKind(_ kind: ActivitySummary.AlertKind) -> String {
            switch kind {
            case .adultRedirect: return "Message de l’enfant à discuter ensemble"
            case .safetyInput: return "Demande sur un sujet sensible"
            case .safetyOutput: return "Réponse bloquée par sécurité"
            case .injectionDetected: return "Instructions suspectes dans un livre"
            case .budgetWarning: return "Budget mensuel atteint à 80 %"
            case .other: return "Alerte"
            }
        }
        static let questionsTitle = "Questions posées"
        static let questionsIntro =
            "Les questions libres (« Pose ta question ») et leur réponse. Elles sont conservées 30 jours."
        static let questionsEmpty = "Aucune question posée ces 30 derniers jours."
        static func questionOutcome(_ outcome: FreeQuestionOutcome) -> String {
            switch outcome {
            case .answered: return "Répondue"
            case .blocked: return "Bloquée"
            case .adultRedirect: return "Renvoyée vers un adulte"
            case .unavailable: return "Non disponible"
            case .other: return ""
            }
        }
        static let showAnswer = "Voir la réponse"
        static let loadFailed = "Impossible de charger l’activité."

        /// §24 texts corrected with « Corriger ».
        enum Writing {
            static let title = "Écriture corrigée"
            static let intro =
                "Les textes corrigés avec « Corriger » dans les zones de texte, conservés un an : de quoi travailler "
                + "l’écriture avec votre enfant."
            static let empty = "Aucun texte corrigé pour le moment."
            static let loadFailed = "Impossible de charger les textes corrigés."
            static let retry = "Réessayer"
            static let summaryTitle = "Corrections sur l’année"
            static let frequentTitle = "Les fautes qui reviennent"
            static func frequentItem(_ count: Int) -> String { format("{count} fois", ["count": String(count)]) }
            static let noFault = "Aucune faute"
            static func corrections(_ count: Int) -> String {
                count == 0 ? noFault
                    : count == 1 ? "1 correction" : format("{count} corrections", ["count": String(count)])
            }
            static let showTexts = "Voir le texte"
            static let original = "Texte de l’enfant"
            static let corrected = "Texte corrigé"
            static func kind(_ kind: WritingChangeKind) -> String {
                switch kind {
                case .accent: return "Accents"
                case .spelling: return "Orthographe"
                case .grammar: return "Grammaire"
                case .punctuation: return "Ponctuation"
                case .capital: return "Majuscules"
                case .space: return "Espaces et mots collés"
                }
            }
        }

        static func duration(minutes: Int) -> String {
            if minutes <= 0 { return "< 1 min" }
            if minutes < 60 { return format("{m} min", ["m": String(minutes)]) }
            return format("{h} h {m} min", ["h": String(minutes / 60), "m": String(minutes % 60)])
        }

        static func euros(_ value: Double) -> String {
            let formatter = NumberFormatter()
            formatter.locale = Locale(identifier: "fr_FR")
            formatter.numberStyle = .currency
            formatter.currencyCode = "EUR"
            return formatter.string(from: NSNumber(value: value)) ?? "\(value) €"
        }
    }

    /// §17.5 the home computer, and §21 the use of its subscription.
    enum Worker {
        static let title = "Ordinateur de la maison"
        static func state(_ state: String) -> String { format("Ordinateur de la maison : {state}", ["state": state]) }
        static let notConfigured = "non configuré"
        static let connected = "connecté"
        static func offline(_ when: String) -> String {
            format("hors ligne (vu pour la dernière fois {when})", ["when": when])
        }
        static let neverSeen = "jamais vu"
        static func limited(_ time: String) -> String {
            format("limite d’utilisation atteinte jusqu’à {time}", ["time": time])
        }
        static let limitedNoTime = "limite d’utilisation atteinte"
        static func pages(_ count: Int) -> String {
            count == 1 ? "1 page en attente de lecture intelligente"
                : format("{count} pages en attente de lecture intelligente", ["count": String(count)])
        }
        static func requests(_ count: Int) -> String {
            count == 1 ? "1 demande d’aide en attente"
                : format("{count} demandes d’aide en attente", ["count": String(count)])
        }
        static func speech(_ count: Int) -> String {
            count == 1 ? "1 page à préparer pour la lecture à voix haute"
                : format("{count} pages à préparer pour la lecture à voix haute", ["count": String(count)])
        }
        static let checking = "Vérification de l’ordinateur de la maison…"
        static let unavailable = "État de l’ordinateur de la maison indisponible pour le moment."
        static let refresh = "Actualiser"

        static func usagePercent(_ percent: Int, _ window: String) -> String {
            format("Abonnement : {percent} % utilisés {window}", ["percent": String(percent), "window": window])
        }
        static func usageComfortable(_ window: String) -> String {
            format("Abonnement : marge confortable {window}", ["window": window])
        }
        static func usageReached(_ window: String) -> String {
            format("Abonnement : limite atteinte {window}", ["window": window])
        }
        static func window(_ window: SubscriptionUsage.Window) -> String {
            switch window {
            case .session: return "sur la session de 5 h"
            case .week: return "sur la semaine"
            case .other: return "sur la période en cours"
            }
        }
        static func resets(_ time: String) -> String { format("Remise à zéro : {time}.", ["time": time]) }
        static func observed(_ when: String) -> String {
            format("Mesuré {when}, à la fin de la dernière demande.", ["when": when])
        }
        static let usageNone =
            "Abonnement : aucune mesure pour l’instant (elle arrive avec la prochaine demande)."
        static func estimate(_ amount: String) -> String { format("Estimation du mois : {amount}", ["amount": amount]) }
        static func estimateAll(_ amount: String) -> String {
            format("Toutes les familles de ce serveur : {amount}", ["amount": amount])
        }
    }

    /// §27 ready-made reading settings, named after what they do.
    enum Profiles {
        static let title = "Profil de lecture"
        static let hint =
            "Choisissez ce qui ressemble le plus à votre enfant : tout se règle d’un coup, et reste modifiable "
            + "un par un ci-dessous."
        static let custom = "Personnalisé : les réglages ont été ajustés un par un."
        static func name(_ id: ReadingProfile.ID) -> String {
            switch id {
            case .confort: return "Lecture confortable"
            case .couleurs: return "Lecture en couleurs"
            case .grandesLettres: return "Grandes lettres aérées"
            case .apprenti: return "Apprenti lecteur (CP–CE1)"
            case .concentration: return "Lecture concentrée"
            }
        }
        static func description(_ id: ReadingProfile.ID) -> String {
            switch id {
            case .confort: return "Les réglages de départ : texte aéré, phrase lue colorée."
            case .couleurs:
                return "Syllabes en couleurs, lettres muettes en gris, sons et liaisons marqués, texte plus espacé, "
                    + "voix plus lente."
            case .grandesLettres:
                return "Grandes lettres très espacées, lignes courtes, règle de lecture, syllabes en couleurs."
            case .apprenti: return "Très grandes lettres, toutes les couleurs de lecture, voix lente."
            case .concentration:
                return "Lignes courtes et règle de lecture pour garder les yeux sur la ligne, sans couleurs sur les "
                    + "lettres."
            }
        }
    }

    /// §20 whether the adult area asks for the code.
    enum PinRequired {
        static let title = "Code à l’ouverture des Réglages"
        static let label = "Demander le code pour ouvrir les Réglages"
        static let hintOn = "Un enfant ne peut pas ouvrir les Réglages sans le code."
        static let hintOff =
            "Les Réglages s’ouvrent sans code sur tous les appareils. Le code reste utile : il est demandé pour "
            + "récupérer le mot de passe."
        static let askOff = "Pour ne plus demander le code, saisissez le mot de passe du compte."
        static let askOn = "Pour demander à nouveau le code, saisissez le mot de passe du compte."
        static let password = "Mot de passe du compte"
        static let confirm = "Confirmer"
        static let doneOff = "Les Réglages s’ouvrent maintenant sans code."
        static let doneOn = "Le code est de nouveau demandé."
    }

    enum Options {
        static let title = "Options"
        static let intro = "L’aide intelligente explique et simplifie. Tout le reste de l’app fonctionne sans elle."
        static let sectionAI = "Aide intelligente"
        static let sectionFeatures = "Fonctions proposées à l’enfant"
        static let sectionLimits = "Limites"
        static let sectionSafety = "Sécurité"
        static let sectionReader = "Lecteur"
        static let sectionPrivacy = "Confidentialité"
        static let sectionOCR = "Lecture des photos et des scans"
        static let enabled = "Activer l’aide intelligente"
        static let enabledHint =
            "Désactivée : pas d’explications, de résumés ni de questions ; la lecture, la voix et les couleurs de lecture restent là."
        static let explainWord = "Expliquer un mot"
        static let explainWordHint = "Vos définitions du glossaire passent en premier."
        static let explainText = "Expliquer un passage"
        static let simplify = "Simplifier un passage"
        static let summarize = "Résumés"
        static let questions = "Questions de compréhension"
        static let correctAnswers = "Corriger les réponses écrites"
        static let correctAnswersHint = "Les autres exercices sont corrigés sur l’iPad."
        static let questionOnText = "Une question sur le texte"
        static let questionOnTextHint = "Une seule question, réponse tirée du texte uniquement."
        static let freeQuestion = "Questions libres (Pose ta question)"
        static let freeQuestionHint =
            "L’enfant pose une question sur n’importe quel sujet, sans lien avec un livre. La réponse est courte et adaptée à son âge."
        static let correctWriting = "Bouton « Corriger » dans les zones de texte"
        static let correctWritingHint =
            "L’enfant fait corriger l’orthographe, la grammaire et la ponctuation de ce qu’il écrit, sans changer ses "
            + "mots ni ses lignes. Chaque correction est gardée dans Activité."
        static let freeQuestionProtectionsTitle = "Protections des questions libres"
        static let freeQuestionProtections = [
            "Les questions inadaptées sont bloquées avant toute réponse.",
            "Les sujets difficiles (tristesse, danger, secrets) sont renvoyés vers un adulte, avec une alerte dans Activité.",
            "Toutes les questions et réponses restent visibles par vous pendant 30 jours, dans Activité.",
        ]
        static let dailyLimit = "Demandes par jour et par enfant"
        static let monthlyBudget = "Budget mensuel"
        static let monthlyBudgetHint =
            "Au-delà, l’aide payée à l’usage se met en pause jusqu’au mois suivant. L’ordinateur de la maison est "
            + "seulement estimé : il ne s’arrête pas."
        static func requests(_ value: Int) -> String { format("{value} demandes", ["value": String(value)]) }
        static let allowComplex = "Autoriser l’analyse approfondie"
        static let allowComplexHint =
            "Pour les longs passages, résumés et questions. Désactivée : versions simples calculées sur l’iPad."
        static let deepQuestions = "Réponses approfondies aux questions sur le texte"
        static let deepQuestionsHint = "Plus lent et plus coûteux."
        static let handwriting = "Reconnaître l’écriture à la main"
        static let handwritingHint =
            "L’image de la réponse est envoyée au service d’aide. Sinon, l’écriture manuscrite de l’iPad (Griffonner) reste disponible."
        static let safetyLevel = "Niveau de prudence"
        static let safetyStandard = "Standard"
        static let safetyStrict = "Strict"
        static let safetyHint =
            "Strict : pas d’aide intelligente sur les thèmes délicats (corps, mort, guerre…), l’enfant est invité à demander à un adulte."
        static let freeSelection = "Sélection libre du texte"
        static let freeSelectionHint =
            "Permet de sélectionner plusieurs mots au doigt. Désactivée : un toucher choisit un mot."
        static let syncAnnotations = "Synchroniser les annotations"
        static let syncAnnotationsHint = "Surlignages et dessins sauvegardés sur votre serveur."
        static let syncDocumentText = "Synchroniser le texte des livres"
        static let syncDocumentTextHint = "Désactivé : le texte reste sur l’iPad où le livre a été importé."
        static let uploadPageImages = "Sauvegarder les images des pages"
        static let uploadPageImagesHint = "Nécessaire pour la vue « page originale » sur un autre appareil."
        static let uploadOriginals = "Sauvegarder les fichiers d’origine"
        static let uploadOriginalsHint = "PDF et photos importés, sur votre serveur."
        static let aiTranscription = "Lecture intelligente des photos et des scans"
        static let aiTranscriptionHint =
            "Les photos et les scans sont lus par l’ordinateur de la maison, pas par l’iPad : le texte arrive en "
            + "quelques secondes sur tous les appareils. Sans l’ordinateur de la maison, l’iPad lit les pages lui-même."
        static var aiTranscriptionNeeds: String {
            format("La lecture intelligente ne peut pas fonctionner : activez aussi « {images} » et « {text} » dans la section Confidentialité.",
                   ["images": uploadPageImages, "text": syncDocumentText])
        }
        static let saved = "Réglages enregistrés."
        static let unsaved = "Modifications non enregistrées"
        static let loadFailed = "Impossible de charger les réglages."
    }
}
