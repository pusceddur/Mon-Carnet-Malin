// Values shared by playwright.config.ts and the specs.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4319);
export const E2E_SETUP_TOKEN = 'e2e-setup-token';

export const PARENT = {
  displayName: 'Camille',
  email: 'parent@example.fr',
  password: 'motdepasse-e2e-123',
  pin: '246810',
} as const;
