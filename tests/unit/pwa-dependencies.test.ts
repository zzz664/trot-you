// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';

const packages = [
  '@serwist/build',
  '@serwist/cli',
  '@serwist/next',
  '@serwist/webpack-plugin',
] as const;

describe('Serwist patched build dependencies', () => {
  it.each(packages)(
    '%s resolves the approved patch-level Zod, not vulnerable 4.6.5',
    (name) => {
      expect(packageJson.overrides[name].zod).toBe('$zod');
      const require = createRequire(import.meta.url);
      const dependencyRequire = createRequire(
        require.resolve(`${name}/package.json`),
      );
      expect(dependencyRequire('zod/package.json').version).toBe(
        packageJson.dependencies.zod,
      );
      expect(packageJson.dependencies.zod).toBe('4.6.7');
    },
  );
});
