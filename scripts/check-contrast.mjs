import assert from 'node:assert/strict';
import { designTokens } from '../src/config/design-tokens.ts';

function luminance(hex) {
  const channels = hex
    .match(/[a-f\d]{2}/gi)
    .map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

const tokens = designTokens.base;
for (const foreground of [
  '--color-text',
  '--color-muted',
  '--color-accent',
  '--color-error',
  '--color-control-border',
]) {
  for (const background of ['--color-background', '--color-surface']) {
    const values = [
      luminance(tokens[foreground]),
      luminance(tokens[background]),
    ].sort((a, b) => b - a);
    const ratio = (values[0] + 0.05) / (values[1] + 0.05);
    assert.ok(
      ratio >= 4.5,
      `${foreground}/${background}: ${ratio.toFixed(2)} < 4.5`,
    );
    console.info(`${foreground}/${background}: ${ratio.toFixed(2)}:1 PASS`);
  }
}
