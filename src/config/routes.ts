export const routes = { home: '/', uiPreview: '/ui-preview' } as const;
export type AppRoute = (typeof routes)[keyof typeof routes];
