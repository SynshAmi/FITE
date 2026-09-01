export interface TransferMetadata {
  transferId: string;
  shareToken: string;
  chunkSize: number;
  totalChunks: number;
  expiresAt: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export type TransferStatus = 'idle' | 'starting' | 'progressing' | 'paused' | 'error' | 'completed' | 'waiting';

export interface TransferProgress {
  status: TransferStatus;
  progress: number;
  transferredBytes: number;
  totalBytes: number;
  metadata: TransferMetadata | null;
  error?: Error;
}
