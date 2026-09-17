/** French messages of /api/ocr errors (shown in the parent import screens). */
export const OCR_MESSAGES_FR = {
  busy: 'Le serveur lit déjà d’autres pages. Réessaie dans un moment.',
  timeout: 'La lecture de cette page a pris trop de temps. Réessaie plus tard.',
  unavailable: 'La lecture sur le serveur n’est pas disponible pour le moment.',
  invalid_image: 'Cette image ne peut pas être lue. Essaie avec une autre photo.',
  unsupported_image: 'Ce format d’image n’est pas accepté. Utilise une image JPEG, PNG ou WebP.',
  image_too_large: 'Cette image est trop grande. Réduis sa taille puis réessaie.',
  missing_image: 'Aucune image n’a été envoyée.',
  failed: 'La lecture de la page a échoué. Réessaie plus tard.',
} as const;
