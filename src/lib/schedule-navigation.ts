function decodedSegments(pathname: string): string[] | null {
  try {
    const segments = pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment));
    // Decode individual segments, never turn encoded separators into routing.
    return segments.some(
      (segment) => segment.includes('/') || segment.includes('\\'),
    )
      ? null
      : segments;
  } catch {
    return null;
  }
}
function canonicalSearch(url: URL): string | null {
  const query = new URLSearchParams(url.search);
  if ([...query.keys()].some((key) => query.getAll(key).length !== 1))
    return null;
  query.sort();
  return query.toString();
}
// Browser URLs may retain percent escapes which Next's decoded params do not.
// Normalize only equivalent spellings; never drop unknown keys or duplicates.
export function scheduleRouteMatches(
  expectedPath: string,
  currentHref: string,
): boolean {
  try {
    const current = new URL(currentHref);
    const expected = new URL(expectedPath, current.origin);
    if (expected.origin !== current.origin) return false;
    const expectedSegments = decodedSegments(expected.pathname);
    const currentSegments = decodedSegments(current.pathname);
    if (
      !expectedSegments ||
      !currentSegments ||
      expectedSegments.length !== currentSegments.length ||
      expectedSegments.some(
        (segment, index) => segment !== currentSegments[index],
      )
    )
      return false;
    const expectedSearch = canonicalSearch(expected);
    const currentSearch = canonicalSearch(current);
    return (
      expectedSearch !== null &&
      currentSearch !== null &&
      expectedSearch === currentSearch
    );
  } catch {
    return false;
  }
}
