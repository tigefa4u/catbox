/**
 * Shared constants for the upload API and the web UI.
 */

/** Maximum accepted upload size: 10 MiB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Human readable form of {@link MAX_UPLOAD_BYTES}. */
export const MAX_UPLOAD_LABEL = '10 MiB';

/** Multipart field name accepted by `POST /upload`. */
export const UPLOAD_FIELD_NAME = 'fileToUpload';
