import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notice } from '@/components/ui/Notice';
import { publicEnvSchema } from '@/config/env';
import { getDesignTokenCss, resolveFontScale } from '@/lib/design-tokens';
import messages from '@/messages/ko.json';

describe('foundation', () => {
  it('renders an accessible preparation notice with supplied copy', () => {
    render(
      <Notice
        title={messages.foundation.statusTitle}
        description={messages.foundation.statusDescription}
      />,
    );
    expect(
      screen.getByRole('region', { name: messages.foundation.statusTitle }),
    ).toBeVisible();
    expect(
      screen.getByText(messages.foundation.statusDescription),
    ).toBeVisible();
  });

  it.each(['normal', 'large', 'xlarge'])(
    'accepts the %s preference',
    (scale) => {
      expect(resolveFontScale(scale)).toBe(scale);
      expect(getDesignTokenCss()).toContain(`data-font-scale="${scale}"`);
    },
  );

  it.each([undefined, '', 'invalid', 'constructor', '__proto__'])(
    'safely defaults invalid font preferences (%s)',
    (scale) => {
      expect(resolveFontScale(scale)).toBe('large');
    },
  );

  it('builds without external credentials and excludes unknown secret fields', () => {
    expect(
      publicEnvSchema.parse({ SUPABASE_SERVICE_ROLE_KEY: 'do-not-export' }),
    ).toEqual({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
  });

  it.each(['not-a-url', 'javascript:alert(1)', 'ftp://example.com'])(
    'rejects invalid public origins (%s)',
    (url) => {
      expect(
        publicEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: url }).success,
      ).toBe(false);
    },
  );
});
