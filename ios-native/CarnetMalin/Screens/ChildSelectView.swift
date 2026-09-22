import CarnetKit
import SwiftUI

/// « Qui lit aujourd’hui ? »
///
/// One big button per child, with their own emoji. No password, no list of names to read carefully: a child who is
/// about to work at reading should not have to read their way in.
struct ChildSelectView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingParentArea = false

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 220, maximum: 320), spacing: Metrics.cardSpacing)]
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 28) {
                    Text(FR.ChildSelect.title)
                        .font(AppFont.title(34))
                        .foregroundStyle(Palette.ink)
                        .padding(.top, 52)

                    if model.children.isEmpty {
                        EmptyStateView(
                            icon: "person.crop.circle.badge.plus",
                            title: FR.ChildSelect.emptyTitle,
                            message: FR.ChildSelect.emptyMessage,
                            actionTitle: FR.ChildSelect.emptyAction
                        ) { showingParentArea = true }
                    } else {
                        LazyVGrid(columns: columns, spacing: Metrics.cardSpacing) {
                            ForEach(model.children) { child in
                                childButton(child)
                            }
                        }
                        .padding(.horizontal, Metrics.gutter)
                    }
                }
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }

            HStack {
                Button {
                    showingParentArea = true
                } label: {
                    Label(FR.Home.parentAccess, systemImage: "gearshape")
                        .font(AppFont.ui(17, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .padding(12)
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, 8)
        }
        .sheet(isPresented: $showingParentArea) {
            NavigationStack { ParentGateView() }
        }
        .task {
            await model.reloadChildren()
            if !model.incomingFiles.isEmpty { showingParentArea = true }
        }
        // A document opened from another app goes to the adult area, the only place books are added.
        .onChange(of: model.incomingFiles.count) { _, count in
            if count > 0 { showingParentArea = true }
        }
    }

    private func childButton(_ child: ChildProfile) -> some View {
        Button {
            model.choose(child)
        } label: {
            VStack(spacing: 14) {
                Text(child.avatar.isEmpty ? "🙂" : child.avatar)
                    .font(.system(size: 72))
                Text(child.nickname)
                    .font(AppFont.ui(26, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 190)
            .padding(20)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Palette.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(FR.ChildSelect.choose(child.nickname))
    }
}
