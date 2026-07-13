// VibeNet — presigned-URL upload/download for encrypted chat attachments.
//
// The backend never receives file bytes: GET /api/upload/presigned-url hands
// back a short-lived S3 PUT URL and a stable object key, the browser PUTs the
// already-encrypted Blob (see lib/fileCrypto.ts) straight to S3, and the key
// alone — never a URL — is what gets embedded in the E2EE message envelope.
// A fresh GET /api/upload/download-url exchange happens on demand whenever a
// recipient renders the attachment (see MessageAttachment.tsx), so chat
// history keeps working long after any one signed URL would have expired.

import { ApiError } from './api';
import { apiClient } from './apiClient';

export interface PresignedUpload {
  uploadUrl: string;
  fileKey: string;
}

// GET /api/upload/presigned-url — mints a presigned PUT URL and the S3 object
// key it targets. filename/filetype are informational only (the backend
// always generates the actual key itself).
export function requestPresignedUpload(filename: string, filetype: string): Promise<PresignedUpload> {
  const params = new URLSearchParams({ filename, filetype });
  return apiClient
    .get<{ upload_url: string; file_key: string }>(`/api/upload/presigned-url?${params}`)
    .then((res) => ({ uploadUrl: res.upload_url, fileKey: res.file_key }));
}

// GET /api/upload/download-url — mints a fresh presigned GET URL for a
// previously-uploaded attachment key.
export function requestDownloadUrl(fileKey: string): Promise<string> {
  const params = new URLSearchParams({ key: fileKey });
  return apiClient
    .get<{ download_url: string }>(`/api/upload/download-url?${params}`)
    .then((res) => res.download_url);
}

// uploadEncryptedBlob PUTs already-encrypted bytes directly to S3 via the
// presigned URL. Deliberately bypasses apiClient: a presigned URL carries its
// own signature in the query string and must NOT get VibeNet's bearer token
// or JSON content-type attached — S3 would reject the write.
export async function uploadEncryptedBlob(uploadUrl: string, blob: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', body: blob });
  } catch {
    throw new ApiError(0, 'Could not reach file storage. Check your connection and try again.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `File upload failed (${res.status}).`);
  }
}

// fetchEncryptedBlob downloads ciphertext bytes from a presigned GET URL, for
// the caller to decrypt (see lib/fileCrypto.ts's decryptFile). Also bypasses
// apiClient for the same reason as uploadEncryptedBlob.
export async function fetchEncryptedBlob(downloadUrl: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(downloadUrl);
  } catch {
    throw new ApiError(0, 'Could not reach file storage. Check your connection and try again.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `File download failed (${res.status}).`);
  }
  return res.arrayBuffer();
}
