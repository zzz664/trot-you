// @vitest-environment node
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderMessage } from '@/server/services/message/render';

describe('single server plain-text calling-name renderer', () => {
  it.each([
    [null, '별님', null],
    ['', '별님', ''],
    ['안녕하세요', '별님', '안녕하세요'],
    ['{이름}님, {이름} 안녕', '별님', '별님님, 별님 안녕'],
    ['{이름}', '달$&별', '달$&별'],
    ['{이름}/{이름}', '{이름}', '{이름}/{이름}'],
    ['{name} { 이름 } {이름}', '별님', '{name} { 이름 } 별님'],
  ])('renders %j with a validated literal name', (template, name, expected) =>
    expect(renderMessage(template, name)).toBe(expected),
  );
  it('uses React text escaping rather than HTML or replacement-string interpretation', () => {
    const text = renderMessage(
      '<script>alert(1)</script> {이름} & "안녕"',
      '<b>별</b>',
    );
    const markup = renderToStaticMarkup(createElement('p', null, text));
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).toContain('&lt;b&gt;별&lt;/b&gt;');
    expect(markup).toContain('&amp; &quot;안녕&quot;');
    expect(markup).not.toMatch(/<script|<b>/);
  });
});
