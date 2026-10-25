// Pure naming contract for real CI captures; no browser or database calls.
export function billingNoticeCaptureScale(title: string) {
  const scale = /^(normal|large|xlarge)(?=[: ])/.exec(title)?.[1];
  return scale === 'normal' || scale === 'large' || scale === 'xlarge'
    ? scale
    : null;
}
