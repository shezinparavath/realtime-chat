/**
 * RTC-UI-02: design tokens (ui-polish-spec.md §4), light mode. Same names as the web CSS custom
 * properties in camelCase (e.g. --color-text-muted -> colors.textMuted). No raw hex values outside
 * this file. Brand: single primary #1d4ed8 (approved by Shezin, rulings Q6).
 */
export const colors = {
  bg: '#f4f5f7',
  surface: '#ffffff',
  surfaceMuted: '#e9ebf0',
  border: '#e1e4e8', // decorative dividers only, never the only boundary of a control
  borderStrong: '#8b929d', // input / control boundary (3.14:1 on white)
  text: '#1d1f23',
  textMuted: '#5b6270',
  primary: '#1d4ed8',
  primaryHover: '#1e40af',
  primaryPressed: '#1e3a8a',
  onPrimary: '#ffffff',
  onPrimaryMuted: '#dbe6ff',
  primarySubtle: '#eff4ff',
  danger: '#b42318',
  dangerBg: '#fdecea',
  warningText: '#7a4b00',
  warningBg: '#fff4d6',
  success: '#2e7d32',
  disabledBg: '#e5e7eb',
  disabledText: '#4b5563',
  focus: '#1d4ed8',
  avatar: ['#1d4ed8', '#b42318', '#2e7d32', '#7c3aed', '#0f766e', '#be185d'],
};

/** §4.2 type scale (mobile body is 16/22). */
export const type = {
  titleLg: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  secondary: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  badge: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
};

/** §4.3 spacing: space[1]..space[10] in px. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 };

/** §4.4 radii. */
export const radius = { sm: 6, md: 10, lg: 18, tail: 4, pill: 999 };

/** §4.5 shadows / elevation. */
export const shadow = {
  sm: { elevation: 1, shadowColor: '#101828', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  md: { elevation: 3, shadowColor: '#101828', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
};
