import { expect, it } from 'vitest';
import { getScheduleMapLinks } from '@/lib/map-links';
it('generates only documented coordinate links and public origin, never path/query identity', () => {
  const links = getScheduleMapLinks(
    37.5,
    127.1,
    'https://app.example/private/fan-name?token=private#location',
  );
  expect(links?.kakao).toBe('https://map.kakao.com/link/map/37.5,127.1');
  const naver = new URL(links!.naver!);
  expect(naver.protocol).toBe('nmap:');
  expect(naver.hostname).toBe('map');
  expect([...naver.searchParams]).toEqual([
    ['lat', '37.5'],
    ['lng', '127.1'],
    ['appname', 'https://app.example'],
  ]);
  expect(JSON.stringify(links)).not.toMatch(/private|fan-name|token|location/);
});
it.each([
  [null, null],
  [37, null],
  [null, 127],
  [NaN, 127],
  [37, Infinity],
  [-91, 127],
  [91, 127],
  [37, -181],
  [37, 181],
])('rejects incomplete or invalid coordinates %#', (lat, lng) =>
  expect(getScheduleMapLinks(lat, lng, 'https://app.example')).toBeNull(),
);
it.each([
  [-90, -180],
  [90, 180],
  [0, 0],
  [31.42, 127],
  [37, 132.01],
])(
  'preserves globally valid coordinates but hides unsupported Naver region %#',
  (lat, lng) => {
    const links = getScheduleMapLinks(lat, lng, 'https://app.example');
    expect(links?.naver).toBeNull();
    expect(links?.kakao).toBe(`https://map.kakao.com/link/map/${lat},${lng}`);
  },
);
it.each([
  'javascript:alert(1)',
  'https://user:secret@app.example',
  'nmap://map',
  'not a URL',
])('disables Naver on unsafe origin %s', (origin) => {
  const links = getScheduleMapLinks(37, 127, origin);
  expect(links?.naver).toBeNull();
  expect(links?.kakao).toBe('https://map.kakao.com/link/map/37,127');
});
it('accepts Naver geographic boundary without rounding event coordinates', () => {
  expect(
    getScheduleMapLinks(31.43, 122.37, 'https://app.example')?.naver,
  ).toBeTruthy();
  expect(
    getScheduleMapLinks(44.35, 132, 'https://app.example')?.naver,
  ).toBeTruthy();
  expect(
    getScheduleMapLinks(37.123456789, 127.987654321, 'https://app.example')
      ?.kakao,
  ).toContain('37.123456789,127.987654321');
});
