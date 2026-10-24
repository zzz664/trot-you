export const COMPOSE_MEDIA_ACCEPT = {
  photo: 'image/jpeg,image/png,image/webp',
  voice: 'audio/mpeg,audio/mp4,audio/webm',
  video: 'video/mp4,video/webm',
} as const;
export const COMPOSE_MEDIA_TYPES = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  voice: ['audio/mpeg', 'audio/mp4', 'audio/webm'],
  video: ['video/mp4', 'video/webm'],
} as const;
