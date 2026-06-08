export const PREVIEW_BUCKET_NAME = 'simfile-previews';
export const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';

// Preview files are logically separated by type within the DTX bucket:
// - Image previews: {simfileId}/preview.jpg
// - Audio previews: {simfileId}/preview.mp3
// Both preview URLs are constructed using PUBLIC_SIMFILE_BUCKET_URL environment variable.
// The bucket names above are kept for documentation and potential future bucket separation.
