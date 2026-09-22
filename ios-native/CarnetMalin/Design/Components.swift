import SwiftUI

/// A large, plain button. The only kind the child ever presses.
struct BigButton: View {
    enum Kind { case primary, secondary, quiet, danger }

    let title: String
    var icon: String?
    var kind: Kind = .primary
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if let icon { Image(systemName: icon).font(AppFont.ui(20, weight: .semibold)) }
                Text(title).font(AppFont.ui(20, weight: .semibold))
            }
            .frame(maxWidth: .infinity, minHeight: Metrics.touchTarget)
            .padding(.horizontal, 20)
            .foregroundStyle(foreground)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.cornerRadius, style: .continuous)
                    .strokeBorder(border, lineWidth: kind == .secondary ? 2 : 0)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.45)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return .white
        case .secondary, .quiet: return Palette.ink
        case .danger: return .white
        }
    }

    private var background: Color {
        switch kind {
        case .primary: return Palette.accent
        case .secondary: return .clear
        case .quiet: return Palette.accentSoft
        case .danger: return Palette.warning
        }
    }

    private var border: Color {
        kind == .secondary ? Palette.line : .clear
    }
}

/// One of the few big choices on the child's home screen.
struct HomeTile: View {
    let title: String
    let subtitle: String?
    let icon: String
    var tint: Color = Palette.accentSoft
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: icon)
                    .font(AppFont.ui(34, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                Text(title)
                    .font(AppFont.ui(24, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.leading)
                if let subtitle {
                    Text(subtitle)
                        .font(AppFont.ui(16))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.leading)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .padding(20)
            .background(tint)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.5)
    }
}

/// A plain panel, used for everything that is a list of things.
struct Card<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.cornerRadius, style: .continuous)
                    .strokeBorder(Palette.line, lineWidth: 1)
            )
    }
}

/// What is shown when a list has nothing in it.
///
/// Never just « vide ». It says what would put something there, because a child looking at an empty screen has no
/// way to know whether they did something wrong.
struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(AppFont.ui(56))
                .foregroundStyle(Palette.muted)
            Text(title).font(AppFont.title(26)).foregroundStyle(Palette.ink)
            Text(message)
                .font(AppFont.ui(18))
                .foregroundStyle(Palette.muted)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                BigButton(title: actionTitle, kind: .secondary, action: action)
                    .frame(maxWidth: 320)
            }
        }
        .frame(maxWidth: 480)
        .padding(32)
    }
}

/// A short message at the top of the screen.
struct BannerView: View {
    let banner: AppModel.Banner
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(AppFont.ui(20, weight: .semibold))
            Text(banner.text).font(AppFont.ui(17)).multilineTextAlignment(.leading)
            Spacer(minLength: 8)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(AppFont.ui(16, weight: .bold))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FR.Common.close)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, Metrics.gutter)
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
    }

    private var icon: String {
        switch banner.tone {
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        }
    }

    private var background: Color {
        switch banner.tone {
        case .info: return Palette.accent
        case .success: return Palette.success
        case .warning: return Palette.warning
        }
    }
}

/// The numeric keypad of the adult area.
///
/// A keypad rather than the system keyboard: the code is four digits, the child is usually watching, and a full
/// keyboard invites a password to be typed into the wrong field.
struct PinPad: View {
    @Binding var digits: String
    let length: Int
    var onComplete: (String) -> Void

    private let keys: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]]

    var body: some View {
        VStack(spacing: 22) {
            HStack(spacing: 14) {
                ForEach(0..<length, id: \.self) { index in
                    Circle()
                        .fill(index < digits.count ? Palette.accent : Palette.line)
                        .frame(width: 18, height: 18)
                }
            }
            .accessibilityLabel(FR.format("{digits} sur {total}", [
                "digits": String(digits.count), "total": String(length),
            ]))

            VStack(spacing: 12) {
                ForEach(keys, id: \.self) { row in
                    HStack(spacing: 12) {
                        ForEach(row, id: \.self) { key in
                            if key.isEmpty {
                                Color.clear.frame(width: 84, height: 68)
                            } else {
                                Button { press(key) } label: {
                                    Text(key)
                                        .font(AppFont.ui(28, weight: .semibold))
                                        .frame(width: 84, height: 68)
                                        .background(Palette.card)
                                        .foregroundStyle(Palette.ink)
                                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                                .strokeBorder(Palette.line, lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(key == "⌫" ? FR.Common.pinBackspace : key)
                            }
                        }
                    }
                }
            }
        }
    }

    private func press(_ key: String) {
        if key == "⌫" {
            if !digits.isEmpty { digits.removeLast() }
            return
        }
        guard digits.count < length else { return }
        digits.append(key)
        if digits.count == length { onComplete(digits) }
    }
}

/// A slider with its value written out, because « 24 px » means something and a bare handle does not.
struct LabelledSlider: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let format: (Double) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
                Spacer()
                Text(format(value)).font(AppFont.ui(17)).foregroundStyle(Palette.muted)
                    .monospacedDigit()
            }
            Slider(value: $value, in: range, step: step)
                .tint(Palette.accent)
                .accessibilityLabel(title)
                .accessibilityValue(format(value))
        }
    }
}

/// A switch with a line under it saying what it does.
///
/// Every reading aid has one. A parent turning things on for their child needs to know what will change on the page
/// before the child meets it, and « Syllabes en couleurs » alone does not say that the text itself stays the same.
struct ExplainedToggle: View {
    let title: String
    let hint: String?
    @Binding var isOn: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: $isOn) {
                Text(title).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            }
            .tint(Palette.accent)
            if let hint {
                Text(hint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
        }
        .padding(.vertical, 4)
    }
}

/// The title bar of a screen the child can leave.
struct ScreenHeader: View {
    let title: String
    var backTitle: String?
    var onBack: (() -> Void)?
    var trailing: AnyView?

    var body: some View {
        HStack(spacing: 14) {
            if let onBack {
                Button(action: onBack) {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left").font(AppFont.ui(18, weight: .bold))
                        Text(backTitle ?? FR.Common.back).font(AppFont.ui(18, weight: .medium))
                    }
                    .foregroundStyle(Palette.accent)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Text(title)
                .font(AppFont.title(28))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
            Spacer(minLength: 8)
            if let trailing { trailing }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 10)
    }
}
