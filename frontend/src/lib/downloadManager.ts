import { getTransferDetails, getAvailableChunks, downloadChunk } from '../api';
import { calculateSHA256 } from './crypto';
import type { TransferMetadata, TransferStatus, TransferProgress } from '../types';

// Simple IndexedDB wrapper for local state tracking
const DB_NAME = 'TransferReceiverDB';
const STORE_NAME = 'local_chunks';

async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getLocalChunks(transferId: string): Promise<number[]> {
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(transferId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch (e) {
    return []; // Fallback to memory
  }
}

async function saveLocalChunk(transferId: string, chunkIndex: number) {
  try {
    const db = await initDB();
    const current = await getLocalChunks(transferId);
    if (!current.includes(chunkIndex)) {
      current.push(chunkIndex);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(current, transferId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  } catch (e) {
    console.error('Failed to save to IndexedDB', e);
  }
}

export class DownloadManager {
  private transferId: string;
  private token: string = '';
  private state: TransferStatus = 'idle';
  private transferDetails: TransferMetadata | null = null;
  private downloadedChunks = new Set<number>();
  private inProgressChunks = new Set<number>();
  private availableChunks: number[] = [];
  private activeDownloads = 0;
  private maxConcurrency = 1; // Start sequentially as per rules
  private onProgressCb?: (progress: TransferProgress) => void;
  private error: Error | undefined;
  private fileHandle: any = null;
  private writable: any = null;
  private cancelSource: AbortController | null = null;

  constructor(transferId: string, maxConcurrency: number = 1) {
    this.transferId = transferId;
    this.maxConcurrency = maxConcurrency;
  }

  onProgress(cb: (progress: TransferProgress) => void) {
    this.onProgressCb = cb;
  }

  private notify() {
    if (this.onProgressCb && this.transferDetails) {
      const downloadedBytes = this.downloadedChunks.size * this.transferDetails.chunkSize;
      const totalBytes = this.transferDetails.fileSize;
      const boundedBytes = Math.min(downloadedBytes, totalBytes);
      this.onProgressCb({
        status: this.state,
        progress: totalBytes === 0 ? 100 : Math.round((boundedBytes / totalBytes) * 100),
        transferredBytes: boundedBytes,
        totalBytes,
        metadata: this.transferDetails,
        error: this.error
      });
    }
  }

  async start(transferId?: string, token?: string) {
    if (this.state === 'progressing' || this.state === 'starting') return;
    if (transferId) this.transferId = transferId;
    if (token) this.token = token;
    
    this.state = 'starting';
    this.error = undefined;
    
    try {
      this.transferDetails = await getTransferDetails(this.transferId, this.token);
      this.notify();

      if ('showSaveFilePicker' in window) {
        this.fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: this.transferDetails.fileName
        });
        this.writable = await this.fileHandle!.createWritable();
      } else {
        throw new Error('File System Access API is not supported in this browser. Please use Chrome/Edge for large file downloads.');
      }
      
      // Reconcile local state
      const local = await getLocalChunks(this.transferId);
      this.downloadedChunks = new Set(local);

      this.state = 'progressing';
      this.cancelSource = new AbortController();
      this.notify();
      this.startPolling();
    } catch (e) {
      if ((e as any).name === 'AbortError') {
        this.state = 'idle';
        this.notify();
        return;
      }
      this.state = 'error';
      this.error = e as Error;
      this.notify();
    }
  }

  pause() {
    if (this.state === 'progressing' || this.state === 'waiting') {
      this.state = 'paused';
      this.cancelSource?.abort();
      this.stopPolling();
      this.notify();
    }
  }

  resume() {
    if (this.state === 'paused' || this.state === 'error') {
      this.state = 'progressing';
      this.error = undefined;
      this.cancelSource = new AbortController();
      this.notify();
      this.startPolling();
    }
  }

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private currentPollInterval = 3000;
  private readonly MAX_POLL_INTERVAL = 15000;

  private startPolling() {
    this.currentPollInterval = 3000;
    this.scheduleNextPoll(0); // Poll immediately
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
  
  private scheduleNextPoll(delayMs: number) {
    this.stopPolling();
    this.pollTimer = setTimeout(() => this.pollAvailability(), delayMs);
  }

  private async pollAvailability() {
    if ((this.state !== 'progressing' && this.state !== 'waiting') || !this.transferDetails) return;
    try {
      const beforeCount = this.availableChunks.length;
      this.availableChunks = await getAvailableChunks(this.transferId, this.token);
      
      // Calculate backoff
      if (this.availableChunks.length > beforeCount) {
        this.currentPollInterval = 3000; // Reset backoff when new data arrives
      } else {
        this.currentPollInterval = Math.min(this.currentPollInterval * 1.5, this.MAX_POLL_INTERVAL);
      }
      
      if (this.availableChunks.length === this.downloadedChunks.size && this.downloadedChunks.size < this.transferDetails.totalChunks) {
         if (this.state !== 'waiting') {
             this.state = 'waiting';
             this.notify();
         }
      } else if (this.availableChunks.length > this.downloadedChunks.size) {
         if (this.state === 'waiting') {
             this.state = 'progressing';
             this.notify();
         }
         this.processQueue();
      }
    } catch (e) {
      if ((e as Error).message === 'TRANSFER_EXPIRED') {
        this.state = 'error';
        this.error = e as Error;
        this.stopPolling();
        this.notify();
        return;
      }
      console.error('Failed to poll availability', e);
      this.currentPollInterval = Math.min(this.currentPollInterval * 2, this.MAX_POLL_INTERVAL);
    }
    
    // Schedule next iteration if still active
    if (this.state === 'progressing' || this.state === 'waiting') {
      this.scheduleNextPoll(this.currentPollInterval);
    }
  }

  private async processQueue() {
    if (this.state !== 'progressing' || !this.transferDetails) return;

    if (this.downloadedChunks.size === this.transferDetails.totalChunks) {
      this.state = 'completed';
      this.stopPolling();
      if (this.writable) {
        await this.writable.close();
      }
      this.notify();
      return;
    }

    while (this.activeDownloads < this.maxConcurrency && this.state === 'progressing') {
      const nextChunkIndex = this.getNextChunkIndex();
      if (nextChunkIndex === -1) break;

      this.activeDownloads++;
      this.downloadChunkWrapper(nextChunkIndex).finally(() => {
        this.activeDownloads--;
        this.processQueue();
      });
    }
  }

  private getNextChunkIndex(): number {
    for (const chunkIndex of this.availableChunks) {
      if (!this.downloadedChunks.has(chunkIndex) && !this.inProgressChunks.has(chunkIndex)) {
        this.inProgressChunks.add(chunkIndex);
        return chunkIndex;
      }
    }
    return -1;
  }

  private async downloadChunkWrapper(chunkIndex: number) {
    if (!this.transferDetails || !this.writable) return;
    try {
      const { blob, checksum } = await downloadChunk(this.transferId, chunkIndex, this.token);
      
      if (this.state !== 'progressing') {
        this.inProgressChunks.delete(chunkIndex);
        return;
      }

      if (checksum) {
        const calculated = await calculateSHA256(blob);
        if (calculated !== checksum) {
          throw new Error(`Checksum mismatch for chunk ${chunkIndex}`);
        }
      }

      const offset = chunkIndex * this.transferDetails.chunkSize;
      
      // Write to file at offset
      await this.writable.write({ type: 'write', position: offset, data: blob });
      
      // Persist local state AFTER successful disk write
      await saveLocalChunk(this.transferId, chunkIndex);
      
      this.inProgressChunks.delete(chunkIndex);
      this.downloadedChunks.add(chunkIndex);
      this.notify();
      
    } catch (e) {
      this.inProgressChunks.delete(chunkIndex);
      if (this.state === 'progressing') {
        console.error(`Chunk ${chunkIndex} failed`, e);
        this.state = 'error';
        this.error = e as Error;
        this.stopPolling();
        this.notify();
      }
    }
  }
}
