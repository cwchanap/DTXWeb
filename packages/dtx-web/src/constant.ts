export const PREVIEW_BUCKET_NAME = 'simfile-previews';
export const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';
export const DTXFILE_BUCKET_NAME = 'simfile-dtx';

// Preview files are stored in separate R2 buckets:
// - Image previews (PREVIEW_BUCKET_NAME): {simfileId}/preview.jpg
// - Audio previews (SOUND_PREVIEW_BUCKET_NAME): {simfileId}/preview.mp3
// URLs are constructed using their respective public bucket environment variables
// (e.g., PUBLIC_PREVIEW_BUCKET_URL for images, PUBLIC_SOUND_PREVIEW_BUCKET_URL for audio)
