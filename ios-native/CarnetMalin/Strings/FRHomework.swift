import Foundation

/// « Mes devoirs » (§19.3) and the text boxes (§19.2, §24). Ported from `homework.ts` and `pencil.ts`.
extension FR {
    enum Homework {
        static let title = "Mes devoirs"
        static let back = "Accueil"
        static func tileTodo(_ count: Int) -> String {
            count == 1 ? "1 devoir à faire" : format("{count} devoirs à faire", ["count": String(count)])
        }
        static let tileNone = "Ajoute une fiche à compléter"
        static let addTitle = "Ajouter un devoir"
        static let addHint = "Prends ta fiche en photo, ou choisis une photo ou un PDF."
        static let nameLabel = "Nom du devoir (si tu veux)"
        static let namePlaceholder = "Par exemple : fiche de maths"
        static let takePhoto = "Prendre en photo"
        static let chooseFile = "Choisir un fichier"
        static func defaultTitle(_ date: String) -> String { format("Devoir du {date}", ["date": date]) }
        static let todo = "À faire"
        static let done = "Terminés"
        static let emptyTitle = "Pas encore de devoir"
        static let emptyMessage = "Ajoute une fiche pour la compléter ici."
        static let noneTodo = "Tout est fait, bravo !"
        static func addedOn(_ date: String) -> String { format("Ajouté le {date}", ["date": date]) }
        static func doneOn(_ date: String) -> String { format("Terminé le {date}", ["date": date]) }
        static func pageOf(_ page: Int, _ total: Int) -> String {
            format("Page {page} sur {total}", ["page": String(page), "total": String(total)])
        }
        static let draw = "Dessiner"
        static let write = "Écrire"
        static let readText = "Lire le texte"
        static let finish = "J’ai terminé"
        static let reopen = "Pas encore fini"
        static let finished = "Bravo, ton devoir est terminé !"
        static let reopened = "Ton devoir est de nouveau à faire."
        static let share = "Envoyer ou imprimer"
        static let shareFailed = "Le fichier n’a pas pu être préparé. Réessaie."
        static let noImage = "L’image de cette page n’est pas sur cet iPad."
    }

    /// « Zone de texte » and « Corriger ».
    enum TextBox {
        static let add = "Zone de texte"
        static let addHint = "Touche la fiche là où tu veux écrire."
        static let placeholder = "Écris ici, ou parle avec le micro du clavier."
        static let fontSize = "Taille"
        static let correct = "Corriger"
        static let correcting = "Je regarde ton texte…"
        static let noMistake = "Je n’ai rien trouvé à corriger. Bravo !"
        static func changes(_ count: Int) -> String {
            count == 1 ? "1 correction" : format("{count} corrections", ["count": String(count)])
        }
        /// §24: said on its own line, because it is the only change that touches how the sentence is built.
        static func rebuilt(_ count: Int) -> String {
            count == 1
                ? "J’ai aussi changé la construction d’une phrase pour que la grammaire soit juste."
                : format("J’ai aussi changé la construction de {count} phrases pour que la grammaire soit juste.",
                         ["count": String(count)])
        }
        static let keepCorrection = "Garder la correction"
        static let keepMine = "Garder mon texte"
        static let delete = "Supprimer la zone"
        static let done = "Terminé"
    }
}
