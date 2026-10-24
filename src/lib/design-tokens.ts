import { DEFAULT_FONT_SCALE } from '../config/constants';
import { designTokens, type FontScale } from '../config/design-tokens';

export function resolveFontScale(value: string | undefined): FontScale {
  return value !== undefined && Object.hasOwn(designTokens.scales, value)
    ? (value as FontScale)
    : DEFAULT_FONT_SCALE;
}

export function getDesignTokenCss(): string {
  const declarations = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([key, value]) => `${key}:${value};`)
      .join('');
  return `:root{${declarations(designTokens.base)}${declarations(designTokens.scales.normal)}}${Object.entries(
    designTokens.scales,
  )
    .map(
      ([scale, tokens]) =>
        `:root[data-font-scale="${scale}"]{${declarations(tokens)}}`,
    )
    .join('')}`;
}
