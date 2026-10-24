export const designTokens = {
  base: {
    '--color-background': '#fff9f5',
    '--color-surface': '#ffffff',
    '--color-text': '#302522',
    '--color-muted': '#65544d',
    '--color-accent': '#923b25',
    '--color-border': '#ddc7bb',
    '--touch-min': '3rem',
    '--input-min-h': '3.5rem',
    '--content-max': '42rem',
    '--radius-card': '1.5rem',
    '--line-body': '1.6',
    '--line-title': '1.3',
  },
  scales: {
    normal: {
      '--fs-body': '1.125rem',
      '--fs-title': '1.375rem',
      '--fs-caption': '1rem',
      '--fs-button': '1.25rem',
      '--space-unit': '0.5rem',
    },
    large: {
      '--fs-body': '1.3125rem',
      '--fs-title': '1.625rem',
      '--fs-caption': '1.125rem',
      '--fs-button': '1.4375rem',
      '--space-unit': '0.625rem',
    },
    xlarge: {
      '--fs-body': '1.5625rem',
      '--fs-title': '1.9375rem',
      '--fs-caption': '1.3125rem',
      '--fs-button': '1.6875rem',
      '--space-unit': '0.75rem',
    },
  },
} as const;

export type FontScale = keyof typeof designTokens.scales;
