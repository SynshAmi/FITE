import { calculateSHA256 } from './crypto';
import { createTransfer, getAvailableChunks, uploadChunk, completeTransfer } from '../api';
import type { TransferMetadata, TransferStatus, TransferProgress } from '../types';

export class UploadManager {
  private file: File | null = null;
  private state: TransferStatus = 'idle';
  private transferDetails: TransferMetadata | null = null;
  
  private completedChunks = new Set<number>();
  private inProgressChunks = new Set<number>();
  
  private activeUploads = 0;
  private maxConcurrency = 1; // Strict bounded sequential upload (no unbounded concurrency)
  private cancelSource: AbortController | null = null;
  private onProgressCb?: (progress: TransferProgress) => void;
  private error: Error | undefined;

  constructor(maxConcurrency: number = 1) {
    this.maxConcurrency = maxConcurrency;
  }

  onProgress(cb: (progress: TransferProgress) => void) {
    this.onProgressCb = cb;
  }

  private notify() {
    if (this.onProgressCb && this.file) {
      const uploadedBytes = this.completedChunks.size * (this.transferDetails?.chunkSize || 0);
      const boundedBytes = Math.min(uploadedBytes, this.file.size);
      this.onProgressCb({
        status: this.state,
        progress: this.file.size === 0 ? 100 : Math.round((boundedBytes / this.file.size) * 100),
        transferredBytes: boundedBytes,
        totalBytes: this.file.size,
        metadata: this.transferDetails,
        error: this.error,
      });
    }
  }

  async start(file: File, existingTransfer?: TransferMetadata) {
    if (this.state === 'progressing' || this.state === 'starting') return;
    
    if (this.file !== file) {
      this.file = file;
      this.transferDetails = existingTransfer || null;
      this.completedChunks.clear();
      this.inProgressChunks.clear();
    }
    
    this.state = 'starting';
    this.error = undefined;
    this.notify();

    try {
      if (!this.transferDetails) {
        this.transferDetails = await createTransfer({
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
        });
      }
      
      await this.reconcile();
      
      this.state = 'progressing';
      this.cancelSource = new AbortController();
      this.notify();
      this.processQueue();
    } catch (e) {
      this.state = 'error';
      this.error = e as Error;
      this.notify();
    }
  }

  pause() {
    if (this.state === 'progressing') {
      this.state = 'paused';
      this.cancelSource?.abort();
      this.notify();
    }
  }

  async resume() {
    if (this.state === 'paused' || this.state === 'error') {
      this.state = 'starting';
      this.error = undefined;
      this.notify();
      try {
        await this.reconcile(); // Reconcile against authoritative backend state on resume
        this.state = 'progressing';
        this.cancelSource = new AbortController();
        this.notify();
        this.processQueue();
      } catch (e) {
        this.state = 'error';
        this.error = e as Error;
        this.notify();
      }
    }
  }

  private async reconcile() {
    if (!this.transferDetails) return;
    try {
      const available = await getAvailableChunks(this.transferDetails.transferId, this.transferDetails.shareToken || '');
      this.completedChunks = new Set(available);
      // Remove any completed chunks from in-progress to prevent double-scheduling
      available.forEach(idx => this.inProgressChunks.delete(idx));
    } catch (e) {
      console.error("Failed to reconcile state against backend", e);
      throw e;
    }
  }

  private async processQueue() {
    if (this.state !== 'progressing' || !this.file || !this.transferDetails) return;

    if (this.completedChunks.size === this.transferDetails.totalChunks) {
      try {
        this.state = 'starting'; // Show loading state during completion call
        this.notify();
        await completeTransfer(this.transferDetails.transferId);
        this.state = 'completed';
        this.notify();
      } catch (e) {
        this.state = 'error';
        this.error = e as Error;
        this.notify();
      }
      return;
    }

    while (this.activeUploads < this.maxConcurrency && this.state === 'progressing') {
      const nextChunkIndex = this.getNextChunkIndex();
      if (nextChunkIndex === -1) break; // All chunks scheduled or done

      this.activeUploads++;
      this.uploadChunkWrapper(nextChunkIndex).finally(() => {
        this.activeUploads--;
        this.processQueue();
      });
    }
  }

  private getNextChunkIndex(): number {
    if (!this.transferDetails) return -1;
    for (let i = 0; i < this.transferDetails.totalChunks; i++) {
      if (!this.completedChunks.has(i) && !this.inProgressChunks.has(i)) {
        this.inProgressChunks.add(i); 
        return i;
      }
    }
    return -1;
  }

  private async uploadChunkWrapper(chunkIndex: number) {
    if (!this.file || !this.transferDetails) return;
    
    // Safety check: skip if reconciled as completed
    if (this.completedChunks.has(chunkIndex)) {
      this.inProgressChunks.delete(chunkIndex);
      return;
    }

    try {
      const start = chunkIndex * this.transferDetails.chunkSize;
      const end = Math.min(start + this.transferDetails.chunkSize, this.file.size);
      const chunkBlob = this.file.slice(start, end); // Memory bounded to active chunk
      
      if (this.state !== 'progressing') {
        this.inProgressChunks.delete(chunkIndex);
        return;
      }

      const checksum = await calculateSHA256(chunkBlob);
      
      if (this.state !== 'progressing') {
        this.inProgressChunks.delete(chunkIndex);
        return;
      }

      await uploadChunk(this.transferDetails.transferId, chunkIndex, chunkBlob, checksum);
      
      this.inProgressChunks.delete(chunkIndex);
      this.completedChunks.add(chunkIndex);
      this.notify();
      
    } catch (e) {
      this.inProgressChunks.delete(chunkIndex);
      if (this.state === 'progressing') {
        console.error(`Chunk ${chunkIndex} failed`, e);
        this.state = 'error';
        this.error = e as Error;
        this.notify();
      }
    }
  }
}
