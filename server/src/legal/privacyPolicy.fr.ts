// The privacy policy, public at /confidentialite: the address given to App Store Connect, linked from the iPad app
// (sign-in, account creation, adult area) and readable without an account or a client build.
//
// Every retention period below is the one the code applies (maintenance/retention.ts, accountDeletion.ts,
// shared constants): change one there and this page must change with it.
import type { LegalConfig } from '../config';

const UPDATED = '24 octobre 2026';
const MISSING = '[à compléter par l’exploitant]';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function value(text: string | null): string {
  return text ? escapeHtml(text) : `<mark>${MISSING}</mark>`;
}

function contactLink(contact: string | null): string {
  if (!contact) return value(null);
  return /^[^\s@]+@[^\s@]+$/.test(contact) ? `<a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>` : escapeHtml(contact);
}

function aiProviders(providers: readonly string[]): string {
  if (providers.length === 0) return `<ul><li>${value(null)}</li></ul>`;
  return `<ul>${providers.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
}

const STYLE = `
:root { color-scheme: light dark; --paper: #fbf6ec; --ink: #1f2328; --muted: #5b6168; --accent: #1d4ed8; --rule: #e6dcc8; }
@media (prefers-color-scheme: dark) { :root { --paper: #17191b; --ink: #ece7dc; --muted: #a8a49b; --accent: #8fb0ff; --rule: #34363a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 30px; line-height: 1.2; margin: 0 0 4px; }
h2 { font-size: 21px; margin: 36px 0 8px; padding-top: 16px; border-top: 1px solid var(--rule); }
p, li { margin: 0 0 10px; }
.updated { color: var(--muted); margin-bottom: 24px; }
a { color: var(--accent); }
mark { background: #fde68a; color: #1f2328; padding: 0 4px; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 16px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--rule); }
th { color: var(--muted); font-weight: 600; }
`;

export function privacyPolicyHtml(legal: LegalConfig): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Politique de confidentialité – Mon Carnet Malin</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Politique de confidentialité</h1>
<p class="updated">Mon Carnet Malin — application web et application iPad. Mise à jour le ${UPDATED}.</p>

<p>Mon Carnet Malin aide les enfants à lire et à faire leurs devoirs. Le compte est toujours celui d’un adulte ; les
enfants n’ont pas de compte, seulement un profil de lecteur créé par cet adulte. Cette page dit quelles données sont
gardées, pourquoi, où elles vont, combien de temps, et comment les faire effacer.</p>

<p><strong>En bref :</strong> pas de publicité, pas de mesure d’audience, pas de pistage, aucun outil tiers dans les
applications. Le prénom réel et l’âge de l’enfant ne sont jamais demandés. Les textes ne partent vers un service d’IA
que pour les fonctions d’aide, que l’adulte peut couper.</p>

<h2>1. Responsable du traitement</h2>
<p>Le serveur qui garde les données est exploité par : ${value(legal.operator)}.</p>
<p>Contact pour toute question ou demande sur vos données : ${contactLink(legal.contact)}.</p>
<p>Hébergement du serveur : ${value(legal.hosting)}.</p>

<h2>2. Les données gardées</h2>
<table>
<thead><tr><th>Quoi</th><th>Pourquoi</th></tr></thead>
<tbody>
<tr><td><strong>Compte de l’adulte</strong> : adresse e-mail, nom affiché, mot de passe et code des réglages (gardés
uniquement sous forme chiffrée irréversible).</td><td>Se connecter, protéger les réglages, envoyer les deux seuls
e-mails de l’app (mot de passe oublié, confirmation d’utilisation tous les 180 jours).</td></tr>
<tr><td><strong>Profils des lecteurs</strong> : un surnom, un avatar, le niveau de lecture et les préférences
d’affichage (police, couleurs, espacements…).</td><td>Adapter la lecture à chaque enfant. Ni prénom réel, ni âge,
ni date de naissance.</td></tr>
<tr><td><strong>Livres et documents</strong> : titre, texte des pages, images des pages (sans les métadonnées de la
photo) et, si l’adulte l’active, le fichier d’origine.</td><td>Afficher le livre sur tous les appareils de la
famille.</td></tr>
<tr><td><strong>Activité de lecture</strong> : progression, notes et dessins, exercices et réponses, devoirs,
questions posées à l’aide et réponses, textes corrigés, glossaire.</td><td>Reprendre où l’enfant s’est arrêté, et
permettre à l’adulte de suivre.</td></tr>
<tr><td><strong>Appareils connectés</strong> : date de connexion, dernière activité, adresse IP, type de navigateur ou
d’appareil, et un nom d’appareil si l’adulte en donne un.</td><td>Sécurité du compte : l’adulte voit les appareils
connectés et peut les déconnecter.</td></tr>
<tr><td><strong>Diagnostics techniques</strong> : type d’erreur (PDF illisible, lecture de la page qui échoue…),
version de l’app et du système, modèle d’appareil, mémoire.</td><td>Corriger les problèmes. Jamais le texte d’une
page, jamais le nom ou un identifiant de l’appareil.</td></tr>
<tr><td><strong>Suivi de l’IA</strong> : type de demande, service utilisé, volume et coût estimé — sans le texte
envoyé.</td><td>Respecter les limites et le budget fixés par l’adulte.</td></tr>
</tbody>
</table>
<p>Sur l’iPad, une copie de ces données est gardée localement pour fonctionner sans réseau. La lecture du texte des
photos (OCR) et la lecture à voix haute se font sur l’appareil.</p>

<h2>3. Bases légales</h2>
<p>L’exécution du service demandé par l’adulte qui crée le compte (article 6.1.b du RGPD) ; l’intérêt légitime pour la
sécurité du compte et les diagnostics techniques (article 6.1.f). Les données des enfants sont fournies par
l’adulte qui en a la charge, sous sa responsabilité.</p>

<h2>4. L’intelligence artificielle</h2>
<p>Certaines aides — expliquer un mot ou un passage, simplifier, résumer, poser des questions sur le texte, corriger
une réponse ou un texte écrit, répondre à une question libre, relire une page photographiée ou une réponse écrite à la
main — envoient à un service d’IA le texte nécessaire : le passage du livre, la question ou la réponse de l’enfant, et
le cas échéant l’image de la page ou de l’écriture.</p>
<p>Ces envois ne contiennent ni le surnom de l’enfant, ni l’adresse e-mail, ni aucun identifiant de compte. Seuls le
niveau de lecture et le niveau des explications sont indiqués, pour adapter la réponse.</p>
<p>Services d’IA que les demandes peuvent atteindre :</p>
${aiProviders(legal.aiProviders)}
<p>Certains de ces services peuvent être situés hors de l’Union européenne (notamment aux États-Unis). Ces transferts
s’appuient sur les garanties prévues par le RGPD (décision d’adéquation ou clauses contractuelles types de la
Commission européenne). Quand aucun service n’est disponible, l’app utilise une version simple calculée sur le
serveur, sans rien envoyer.</p>
<p><strong>Ce que l’adulte contrôle</strong>, dans les réglages : couper toute l’IA, ou chaque aide une par une ; couper
la relecture des pages par l’IA ; fixer une limite par jour et un budget par mois.</p>

<h2>5. Autres destinataires</h2>
<ul>
<li><strong>Envoi des e-mails</strong> : le prestataire d’envoi utilisé par le serveur reçoit l’adresse e-mail et le
nom affiché, uniquement pour les deux messages décrits plus haut.</li>
<li><strong>Wiktionnaire</strong> : pour la définition d’un mot, le serveur peut interroger fr.wiktionary.org avec
<em>ce mot seulement</em>, sans aucune information sur l’enfant ou le compte. Les appareils ne le contactent jamais
eux-mêmes.</li>
</ul>
<p>Aucune donnée n’est vendue, louée ni utilisée pour de la publicité ou du profilage.</p>

<h2>6. Combien de temps</h2>
<table>
<thead><tr><th>Donnée</th><th>Durée</th></tr></thead>
<tbody>
<tr><td>Compte, livres, notes, activité</td><td>Tant que le compte existe ; effacés immédiatement à sa suppression</td></tr>
<tr><td>Profil d’un lecteur supprimé, avec toutes ses données</td><td>30 jours, puis effacement définitif</td></tr>
<tr><td>Document supprimé : fichiers, images et texte des pages</td><td>30 jours (le titre reste, pour la
synchronisation des appareils, jusqu’à la suppression du compte)</td></tr>
<tr><td>Questions libres posées à l’aide</td><td>30 jours</td></tr>
<tr><td>Textes corrigés</td><td>1 an</td></tr>
<tr><td>Diagnostics techniques</td><td>30 jours</td></tr>
<tr><td>Alertes de sécurité déjà vues</td><td>90 jours</td></tr>
<tr><td>Suivi de l’IA (sans texte)</td><td>180 jours</td></tr>
<tr><td>Demandes en attente auprès de l’IA (avec le texte)</td><td>1 heure après la réponse, 7 jours au plus</td></tr>
<tr><td>Connexions d’un appareil</td><td>180 jours au plus</td></tr>
</tbody>
</table>
<p>Tous les 180 jours, un e-mail demande de confirmer que le compte sert encore ; sans réponse dans les 14 jours
(ou connexion avec le mot de passe), tous les appareils sont déconnectés.</p>

<h2>7. Sécurité</h2>
<p>Les échanges sont chiffrés (HTTPS). Les mots de passe et codes ne sont jamais gardés en clair. Sur l’iPad, la clé
de connexion est rangée dans le trousseau de l’appareil. Chaque famille ne voit que ses propres données.</p>

<h2>8. Vos droits</h2>
<p>Vous pouvez à tout moment accéder à vos données, les corriger, les faire effacer, en demander une copie, vous
opposer à un traitement ou en demander la limitation, en écrivant à ${contactLink(legal.contact)}.</p>
<ul>
<li><strong>Supprimer le compte</strong> directement dans l’app ou sur le site, depuis la page du compte de l’espace parent
(« Supprimer le compte »).
Tout est effacé immédiatement, sur le serveur et sur tous les appareils.</li>
<li><strong>Effacer un appareil</strong> : à la déconnexion, l’option « Effacer aussi les livres, les pages et les
notes de cet appareil » est cochée par défaut.</li>
</ul>
<p>Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNIL (<a href="https://www.cnil.fr">cnil.fr</a>).</p>

<h2>9. Cookies</h2>
<p>Le site n’utilise qu’un seul cookie, indispensable : celui qui garde la session ouverte (180 jours au plus). Aucun
cookie de mesure d’audience ou de publicité. L’app iPad n’utilise pas de cookie.</p>

<h2>10. Modifications</h2>
<p>Toute modification sera publiée sur cette page, avec sa date. Un changement important sera signalé dans l’app.</p>
</main>
</body>
</html>
`;
}
