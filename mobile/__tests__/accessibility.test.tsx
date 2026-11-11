// Non-régression d'accessibilité des écrans d'authentification (parcours critique) : chaque
// élément actionnable expose un rôle et un nom accessibles, chaque champ un libellé, et les
// erreurs de validation sont annoncées. React Native ne dispose pas d'un équivalent d'axe : ces
// assertions vérifient ce que VoiceOver et TalkBack lisent ; le reste (taille des cibles,
// contraste, ordre de lecture réel) relève de l'audit manuel (docs/qualite-et-performance.md).
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { useLocalSearchParams } from 'expo-router';

import ForgotPasswordScreen from '../src/screens/auth/ForgotPasswordScreen';
import LoginScreen from '../src/screens/auth/LoginScreen';
import RegisterScreen from '../src/screens/auth/RegisterScreen';
import ResetPasswordScreen from '../src/screens/auth/ResetPasswordScreen';
import { useAuth } from '../src/features/auth/session';

jest.mock('../src/features/auth/recovery');
jest.mock('../src/features/auth/session', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useAuth).mockReturnValue({
    user: null,
    token: null,
    initializing: false,
    signIn: jest.fn(),
    logout: jest.fn(),
    refreshUser: jest.fn(),
    clearSession: jest.fn().mockResolvedValue(undefined),
    updateCurrentUser: jest.fn(),
  });
  jest.mocked(useLocalSearchParams).mockReturnValue({ token: 'opaque-token' });
});

// Texte lu par un lecteur d'écran pour un élément : son libellé, sinon le texte qu'il contient.
function accessibleName(node: TestInstance): string {
  if (typeof node.props.accessibilityLabel === 'string') return node.props.accessibilityLabel;
  if (typeof node.props['aria-label'] === 'string') return node.props['aria-label'];
  const texts: string[] = [];
  const walk = (n: TestInstance | string) => {
    if (typeof n === 'string') texts.push(n);
    else n.children.forEach(walk);
  };
  walk(node);
  return texts.join('').trim();
}

// Éléments natifs actionnables (le rendu de test ne garde que les éléments hôtes), tels que
// l'accessibilité les voit.
function actionables(root: TestInstance): TestInstance[] {
  return root.queryAll(
    (n) => typeof n.props.onPress === 'function' || typeof n.props.onClick === 'function',
  );
}

function expectAccessible() {
  const root = screen.container;
  const problems: string[] = [];
  for (const node of actionables(root)) {
    const role = node.props.accessibilityRole ?? node.props.role;
    const name = accessibleName(node);
    if (!role) problems.push(`élément actionnable sans rôle : « ${name} »`);
    if (!name) problems.push(`élément actionnable sans nom (rôle ${role})`);
    if (node.props.accessible === false) problems.push(`élément actionnable masqué : « ${name} »`);
  }
  const inputs = root.queryAll((n) => n.type === 'TextInput');
  for (const input of inputs) {
    const label = input.props.accessibilityLabel ?? input.props['aria-label'];
    if (!label) problems.push(`champ sans libellé (placeholder : ${input.props.placeholder ?? '—'})`);
  }
  expect(problems).toEqual([]);
  // Garde-fous : les écrans testés ont tous un formulaire et un bouton.
  expect(actionables(root).length).toBeGreaterThan(0);
  expect(inputs.length).toBeGreaterThan(0);
}

const screens: [string, () => React.JSX.Element][] = [
  ['connexion', () => <LoginScreen />],
  ['inscription', () => <RegisterScreen />],
  ['mot de passe oublié', () => <ForgotPasswordScreen />],
  ['nouveau mot de passe', () => <ResetPasswordScreen />],
];

describe('accessibilité des écrans d’authentification', () => {
  it.each(screens)('%s : rôles, noms et libellés', async (_, Screen) => {
    await render(<Screen />);
    expectAccessible();
  });

  it('connexion : les erreurs de validation restent accessibles et annoncées', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByLabelText('Sign in'));
    const message = screen.getByText('Enter your email and password.');
    // Le message est lu : rôle d'alerte ou région annoncée sur l'élément ou un parent.
    let node: TestInstance | null = message;
    let announced = false;
    while (node) {
      const role = node.props.accessibilityRole ?? node.props.role;
      if (role === 'alert' || node.props.accessibilityLiveRegion || node.props['aria-live']) announced = true;
      node = node.parent;
    }
    expect(announced).toBe(true);
    expectAccessible();
  });
});
