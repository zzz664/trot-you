// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
async function rules(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe('configuration and pure-layer lint boundaries', () => {
  it.each([
    'export const value = process.env.SECRET;',
    "export const value = process['env'].SECRET;",
    'const { env } = process; export { env };',
    'const runtime = process; export { runtime };',
  ])(
    'rejects environment access outside the dedicated modules',
    async (code) => {
      expect(await rules('src/config/probe.ts', code)).toContain(
        'no-restricted-syntax',
      );
      expect(await rules('src/lib/probe.ts', code)).toContain(
        'no-restricted-syntax',
      );
    },
  );
  it('allows environment reads only in the explicit modules', async () => {
    expect(
      await rules(
        'src/config/env.server.ts',
        'export const value = process.env.SECRET;',
      ),
    ).not.toContain('no-restricted-syntax');
    expect(
      await rules(
        'src/config/env.ts',
        'export const value = process.env.NEXT_PUBLIC_APP_URL;',
      ),
    ).not.toContain('no-restricted-syntax');
  });
  it.each(['src/lib/probe.ts', 'src/components/ui/Probe.tsx'])(
    'rejects server env in a pure/client-safe layer (%s)',
    async (path) => {
      expect(
        await rules(
          path,
          "import { getServerEnv } from '@/config/env.server'; export const value = getServerEnv;",
        ),
      ).toContain('no-restricted-imports');
    },
  );
  it('restricts reverse-layer dependencies and direct I/O', async () => {
    expect(
      await rules(
        'src/lib/probe.ts',
        "import { logger } from '@/server/logging/logger'; export const value = logger;",
      ),
    ).toContain('no-restricted-imports');
    expect(
      await rules(
        'src/config/probe.ts',
        "import { logger } from '@/server/logging/logger'; export const value = logger;",
      ),
    ).toContain('no-restricted-imports');
    expect(
      await rules(
        'src/lib/probe.ts',
        "export const value = () => fetch('https://example.com');",
      ),
    ).toContain('no-restricted-globals');
  });
  it('allows console output only at the server logger sink', async () => {
    expect(
      await rules('src/server/configuration.ts', "console.info('unsafe');"),
    ).toContain('no-console');
    expect(
      await rules('src/server/logging/logger.ts', "console.info('sanitized');"),
    ).not.toContain('no-console');
  });
  it('keeps onboarding UI and browser transport behind their boundaries', async () => {
    expect(
      await rules(
        'src/components/onboarding/Probe.tsx',
        'export const Probe = () => <button>probe</button>;',
      ),
    ).toContain('no-restricted-syntax');
    expect(
      await rules(
        'src/components/onboarding/Probe.tsx',
        "import { createOnboardingPort } from '@/server/db/onboarding'; export const value = createOnboardingPort;",
      ),
    ).toContain('no-restricted-imports');
    expect(
      await rules(
        'src/client/probe.ts',
        "import { getServerEnv } from '@/config/env.server'; export const value = getServerEnv;",
      ),
    ).toContain('no-restricted-imports');
  });
  it.each(['button', 'input', 'a'])(
    'keeps calendar %s controls inside accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/content-calendar/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it('keeps calendar data and provider I/O outside UI components', async () => {
    for (const importPath of [
      '@/server/db/content-calendar',
      '@/server/adapters/payment/toss',
    ]) {
      expect(
        await rules(
          'src/components/content-calendar/Probe.tsx',
          `import value from '${importPath}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    }
  });
  it.each(['button', 'input', 'a'])(
    'keeps community board %s controls inside accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/community-posts/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it('keeps community board data and provider I/O outside UI components', async () => {
    for (const importPath of [
      '@/server/db/community-posts',
      '@/server/adapters/payment/toss',
    ]) {
      expect(
        await rules(
          'src/components/community-posts/Probe.tsx',
          `import value from '${importPath}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    }
  });
  it.each(['button', 'input', 'a'])(
    'keeps community interaction %s controls inside accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/community-interactions/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it('keeps community interaction data and provider I/O outside UI components', async () => {
    for (const importPath of [
      '@/server/db/community-interactions',
      '@/server/adapters/payment/toss',
    ]) {
      expect(
        await rules(
          'src/components/community-interactions/Probe.tsx',
          `import value from '${importPath}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    }
  });
  it('keeps moderation screens behind accessible UI and database boundaries', async () => {
    expect(
      await rules(
        'src/components/community-moderation/Probe.tsx',
        'export const Probe = () => <button>probe</button>;',
      ),
    ).toContain('no-restricted-syntax');
    expect(
      await rules(
        'src/components/community-moderation/Probe.tsx',
        "import { createModerationPort } from '@/server/db/community-moderation'; export const value = createModerationPort;",
      ),
    ).toContain('no-restricted-imports');
  });
});

describe('attendance points UI boundaries', () => {
  it.each(['button', 'input', 'a'])(
    'keeps %s in accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/attendance-points/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it.each(['@/server/db/attendance-points', '@/server/adapters/payment/toss'])(
    'keeps data and external I/O out of UI: %s',
    async (path) => {
      expect(
        await rules(
          'src/components/attendance-points/Probe.tsx',
          `import value from '${path}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    },
  );
});

describe('activity rewards UI boundaries', () => {
  it.each(['button', 'input', 'a'])(
    'keeps %s in accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/activity-rewards/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it.each(['@/server/db/activity-rewards', '@/server/adapters/payment/toss'])(
    'keeps data and external I/O out of UI: %s',
    async (path) => {
      expect(
        await rules(
          'src/components/activity-rewards/Probe.tsx',
          `import value from '${path}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    },
  );
  it.each(['button', 'input', 'a'])(
    'keeps analytics %s in accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/attendance-points/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it.each(['@/server/db/attendance-points', '@/server/adapters/payment/toss'])(
    'keeps analytics data and external I/O out of UI: %s',
    async (path) => {
      expect(
        await rules(
          'src/components/attendance-points/Probe.tsx',
          `import value from '${path}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    },
  );
});

describe('activity rewards UI boundaries', () => {
  it.each(['button', 'input', 'a'])(
    'keeps analytics %s in accessible primitives',
    async (element) => {
      expect(
        await rules(
          'src/components/analytics-funnel/Probe.tsx',
          `export const Probe = () => <${element} />;`,
        ),
      ).toContain('no-restricted-syntax');
    },
  );
  it.each(['@/server/db/analytics-funnel', '@/server/adapters/payment/toss'])(
    'keeps analytics data and external I/O out of UI: %s',
    async (path) => {
      expect(
        await rules(
          'src/components/analytics-funnel/Probe.tsx',
          `import value from '${path}'; export { value };`,
        ),
      ).toContain('no-restricted-imports');
    },
  );
});
