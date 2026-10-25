import { SCHEDULES, SCHEDULE_MAPS } from '@/config/schedules';

// Only PUBLIC event coordinates and the PUBLIC application origin are sent.
// Never accept stored URLs, event descriptions/names, user IDs or user location.
// Rendering these strings performs no I/O; UI must use deliberate plain links
// with no referrer, no prefetch, and no automatic application/store fallback.
export function getScheduleMapLinks(
  lat: number | null,
  lng: number | null,
  appOrigin: string,
) {
  if (
    lat === null ||
    lng === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < SCHEDULES.minLatitude ||
    lat > SCHEDULES.maxLatitude ||
    lng < SCHEDULES.minLongitude ||
    lng > SCHEDULES.maxLongitude
  )
    return null;
  const kakao = `${SCHEDULE_MAPS.kakaoBase}${lat},${lng}`;
  let naver: string | null = null;
  try {
    const origin = new URL(appOrigin);
    if (
      (origin.protocol === 'https:' || origin.protocol === 'http:') &&
      !origin.username &&
      !origin.password &&
      lat >= SCHEDULE_MAPS.naverMinLatitude &&
      lat <= SCHEDULE_MAPS.naverMaxLatitude &&
      lng >= SCHEDULE_MAPS.naverMinLongitude &&
      lng <= SCHEDULE_MAPS.naverMaxLongitude
    ) {
      const url = new URL(SCHEDULE_MAPS.naverBase);
      url.search = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        appname: origin.origin,
      }).toString();
      naver = url.toString();
    }
  } catch {
    /* Invalid caller origin disables only the app link. */
  }
  return { naver, kakao };
}
