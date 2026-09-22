import CarnetKit
import SwiftUI

/// « Glossaire »: the words the parent defined, which come before the help's own.
struct GlossaryView: View {
    @EnvironmentObject private var model: AppModel

    @State private var entries: [GlossaryEntry] = []
    @State private var search = ""
    @State private var editing: EditingEntry?
    @State private var isNew = false
    @State private var message: String?

    private var shown: [GlossaryEntry] {
        let query = TextNormalizer.normalizedForMatch(search)
        guard !query.isEmpty else { return entries }
        return entries.filter { TextNormalizer.normalizedForMatch($0.headword).contains(query) }
    }

    var body: some View {
        List {
            Section {
                Text("Vos définitions passent avant celles de l’aide intelligente. Écrivez-les simplement, pour un enfant de 8 à 11 ans.")
                    .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                if let message { Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.accent) }
            }
            if entries.isEmpty {
                Text("Ajoutez les mots de la classe que votre enfant rencontre souvent.")
                    .font(AppFont.ui(16)).foregroundStyle(Palette.muted)
            }
            ForEach(shown) { entry in
                Button {
                    isNew = false
                    editing = EditingEntry(entry: entry)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.headword).font(AppFont.ui(18, weight: .semibold)).foregroundStyle(Palette.ink)
                        Text(entry.kidDefinition).font(AppFont.ui(15)).foregroundStyle(Palette.muted).lineLimit(2)
                    }
                }
                .swipeActions {
                    Button("Supprimer", role: .destructive) { Task { await delete(entry) } }
                }
            }
        }
        .searchable(text: $search, prompt: "Rechercher un mot")
        .scrollContentBackground(.hidden)
        .background(Palette.paper)
        .navigationTitle("Glossaire")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    isNew = true
                    editing = EditingEntry(entry: GlossaryEntry(headword: "", partOfSpeech: .noun, kidDefinition: ""))
                } label: {
                    Label("Ajouter un mot", systemImage: "plus")
                }
            }
        }
        .task { await reload() }
        .sheet(item: $editing) { item in
            GlossaryEntryForm(entry: item.entry, isNew: isNew, existing: Set(entries.map(\.headword))) { saved in
                Task { await save(saved) }
            }
        }
    }

    /// The sheet needs a stable identity even while the headword is being typed.
    private struct EditingEntry: Identifiable {
        let id = UUID()
        let entry: GlossaryEntry
    }

    private func reload() async {
        guard let api = model.services?.api else { return }
        do {
            entries = try await api.glossary().sorted { $0.headword < $1.headword }
        } catch {
            message = "Hors ligne : les modifications du glossaire nécessitent une connexion."
        }
    }

    private func save(_ entry: GlossaryEntry) async {
        guard let api = model.services?.api else { return }
        do {
            _ = try await api.saveGlossaryEntry(entry)
            message = "Mot enregistré."
            editing = nil
            await reload()
        } catch {
            message = FR.Errors.message(for: error)
        }
    }

    private func delete(_ entry: GlossaryEntry) async {
        guard let api = model.services?.api else { return }
        do {
            try await api.deleteGlossaryEntry(headword: entry.headword)
            message = "Mot supprimé."
            await reload()
        } catch {
            message = FR.Errors.message(for: error)
        }
    }
}

private struct GlossaryEntryForm: View {
    let entry: GlossaryEntry
    let isNew: Bool
    let existing: Set<String>
    let onSave: (GlossaryEntry) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft = GlossaryEntry(headword: "", partOfSpeech: .noun, kidDefinition: "")
    @State private var example = ""
    @State private var forms = ""
    @State private var problems: [String] = []

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Mot", text: $draft.headword)
                        .textInputAutocapitalization(.never)
                        .disabled(!isNew)
                    Text("Forme de base, en minuscules (ex. : « volcan », « grandir »).")
                        .font(AppFont.ui(13)).foregroundStyle(Palette.muted)
                    Picker("Nature", selection: $draft.partOfSpeech) {
                        Text("Nom").tag(GlossaryEntry.PartOfSpeech.noun)
                        Text("Verbe").tag(GlossaryEntry.PartOfSpeech.verb)
                        Text("Adjectif").tag(GlossaryEntry.PartOfSpeech.adjective)
                        Text("Adverbe").tag(GlossaryEntry.PartOfSpeech.adverb)
                        Text("Expression").tag(GlossaryEntry.PartOfSpeech.expression)
                        Text("Autre").tag(GlossaryEntry.PartOfSpeech.other)
                    }
                }
                Section {
                    TextEditor(text: $draft.kidDefinition).frame(minHeight: 100)
                    Text("\(Tokenizer.countWords(draft.kidDefinition)) / \(GlossaryEntry.definitionMaxWords) mots")
                        .font(AppFont.ui(13)).monospacedDigit()
                        .foregroundStyle(
                            Tokenizer.countWords(draft.kidDefinition) > GlossaryEntry.definitionMaxWords
                                ? Palette.warning : Palette.muted
                        )
                } header: { Text("Définition pour l’enfant") }
                Section("Exemple") {
                    TextField("", text: $example, axis: .vertical)
                }
                Section {
                    TextField("", text: $forms)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Autres formes")
                } footer: {
                    Text("Séparées par des virgules (ex. : volcans, volcanique).")
                }
                if !problems.isEmpty {
                    Section { ForEach(problems, id: \.self) { Text($0).foregroundStyle(Palette.warning) } }
                }
            }
            .navigationTitle(isNew ? "Nouveau mot" : FR.format("Modifier « {mot} »", ["mot": entry.headword]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(FR.Common.cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(FR.Common.save) {
                        var candidate = draft
                        candidate.example = example
                        candidate.forms = forms.split(separator: ",").map(String.init)
                        candidate = candidate.cleaned
                        var found = candidate.problems
                        if isNew && existing.contains(candidate.headword) { found.append("Ce mot existe déjà.") }
                        problems = found
                        guard found.isEmpty else { return }
                        onSave(candidate)
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            draft = entry
            example = entry.example ?? ""
            forms = (entry.forms ?? []).joined(separator: ", ")
        }
    }
}
