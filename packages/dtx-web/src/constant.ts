export const PREVIEW_BUCKET_NAME = 'simfile-previews';
export const SOUND_PREVIEW_BUCKET_NAME = 'simfile-sound-previews';
export const DTXFILE_BUCKET_NAME = 'simfile-dtx';

// Preview files are stored in R2 at: {simfileId}/preview.jpg and {simfileId}/preview.mp3
// URLs are constructed using PUBLIC_SIMFILE_BUCKET_URL environment variable
