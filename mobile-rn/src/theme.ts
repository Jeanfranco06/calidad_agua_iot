import {ColorSchemeName} from 'react-native';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  line: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  warn: string;
  warnSoft: string;
  bad: string;
  badSoft: string;
  good: string;
  goodSoft: string;
  scrim: string;
  isDark: boolean;
}

// Claro: papel cálido + verde azulado profundo. Sin degradados ni brillos.
export const LIGHT: Palette = {
  bg: '#F4F2EC',
  surface: '#FFFFFF',
  surfaceAlt: '#EEEBE3',
  ink: '#1F2B2C',
  inkSoft: '#586665',
  inkFaint: '#8A9593',
  line: '#DEDACF',
  primary: '#2E6F6A',
  primarySoft: '#DDEAE7',
  onPrimary: '#FFFFFF',
  warn: '#A5642A',
  warnSoft: '#F5E7D6',
  bad: '#A2443A',
  badSoft: '#F4DEDA',
  good: '#3C7A4D',
  goodSoft: '#DFEDE2',
  scrim: 'rgba(25, 32, 33, 0.45)',
  isDark: false,
};

// Oscuro: grafito verdoso, contraste moderado, sin neones.
export const DARK: Palette = {
  bg: '#171B1C',
  surface: '#1F2527',
  surfaceAlt: '#282F31',
  ink: '#E7E5DF',
  inkSoft: '#A0AAA8',
  inkFaint: '#74807E',
  line: '#343C3E',
  primary: '#86BDB6',
  primarySoft: '#27393A',
  onPrimary: '#0F1E1D',
  warn: '#D9A06A',
  warnSoft: '#3A2F23',
  bad: '#DC8D83',
  badSoft: '#3B2623',
  good: '#93C4A1',
  goodSoft: '#243228',
  scrim: 'rgba(0, 0, 0, 0.6)',
  isDark: true,
};

export type ThemeMode = 'light' | 'dark' | 'system';

export const resolvePalette = (mode: ThemeMode, system: ColorSchemeName | null | undefined): Palette => {
  if (mode === 'light') return LIGHT;
  if (mode === 'dark') return DARK;
  return system === 'dark' ? DARK : LIGHT;
};
