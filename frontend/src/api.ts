import type { TransferMetadata } from './types';

export interface CreateTransferRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
}

export async function createTransfer(request: CreateTransferRequest): Promise<TransferMetadata> {
  const response = await fetch('/api/transfers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw new Error('Failed to create transfer');
  return response.json();
}

export async function uploadChunk(
  transferId: string, 
  chunkIndex: number, 
  chunk: Blob, 
  checksum: string
): Promise<void> {
  const response = await fetch(`/api/transfers/${transferId}/chunks/${chunkIndex}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Checksum-SHA256': checksum
    },
    body: chunk
  });
  if (!response.ok) throw new Error(`Failed to upload chunk ${chunkIndex}`);
}

export async function completeTransfer(transferId: string): Promise<void> {
  const response = await fetch(`/api/transfers/${transferId}/complete`, { method: 'POST' });
  if (!response.ok) throw new Error('Failed to complete transfer');
}

export async function getTransferDetails(transferId: string, token: string): Promise<TransferMetadata> {
  const response = await fetch(`/api/transfers/${transferId}?token=${encodeURIComponent(token)}`);
  if (response.status === 410) throw new Error('TRANSFER_EXPIRED');
  if (!response.ok) throw new Error('Failed to get transfer');
  return response.json();
}

export async function getAvailableChunks(transferId: string, token: string): Promise<number[]> {
  const response = await fetch(`/api/transfers/${transferId}/chunks?token=${encodeURIComponent(token)}`);
  if (response.status === 410) throw new Error('TRANSFER_EXPIRED');
  if (!response.ok) throw new Error('Failed to get availability');
  return response.json();
}

export async function downloadChunk(transferId: string, chunkIndex: number, token: string): Promise<{blob: Blob, checksum: string | null}> {
  const response = await fetch(`/api/transfers/${transferId}/chunks/${chunkIndex}?token=${encodeURIComponent(token)}`);
  if (response.status === 410) throw new Error('TRANSFER_EXPIRED');
  if (!response.ok) throw new Error(`Failed to download chunk ${chunkIndex}`);
  const checksum = response.headers.get('Upload-Checksum');
  const blob = await response.blob();
  return { blob, checksum };
}
