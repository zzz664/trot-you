export type CancellationFixtureState = {
  scenario: string;
  refunds: { toss: number; kakao: number };
};
export type CancellationFixtureReply = {
  status?: number;
  body?: unknown;
  lost?: boolean;
  hold?: boolean;
};
export function createCancellationFixtureState(): CancellationFixtureState;
export function cancellationFixtureResponse(
  state: CancellationFixtureState,
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  },
): CancellationFixtureReply;
