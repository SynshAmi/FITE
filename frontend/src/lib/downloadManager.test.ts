import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DownloadManager } from './downloadManager';
import 'fake-indexeddb/auto'; // Mock indexedDB

const mockGetTransferDetails = vi.fn();
const mockGetAvailableChunks = vi.fn();
const mockDownloadChunk = vi.fn();

vi.mock('../api', () => ({
  getTransferDetails: (...args: any[]) => mockGetTransferDetails(...args),
  getAvailableChunks: (...args: any[]) => mockGetAvailableChunks(...args),
  downloadChunk: (...args: any[]) => mockDownloadChunk(...args),
}));

vi.mock('./crypto', () => ({
  calculateSHA256: async (_blob: Blob) => {
    return 'mock-sha256';
  }
}));

describe('DownloadManager State Machine', () => {
  let manager: DownloadManager;
  let mockWritable: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    
    // Clear fake indexedDB
    indexedDB.deleteDatabase('TransferReceiverDB');

    mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };

    (globalThis as any).window = {
      showSaveFilePicker: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue(mockWritable)
      })
    };

    manager = new DownloadManager('test-id', 1);
  });

  afterEach(() => {
    manager.pause();
    vi.useRealTimers();
  });

  it('starts successfully and processes available chunks sequentially', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileName: 'test.txt',
      fileSize: 100,
      chunkSize: 50,
      totalChunks: 2
    });

    // Server says chunk 0 is available
    mockGetAvailableChunks.mockResolvedValue([0]);
    
    mockDownloadChunk.mockResolvedValue({
      blob: new Blob(['chunk0']),
      checksum: 'mock-sha256'
    });

    const progressLogs: string[] = [];
    manager.onProgress((p) => {
      progressLogs.push(p.status);
    });

    await manager.start('test-id', 'token123');

    // Fast forward to process queue
    await vi.runAllTimersAsync();

    expect(mockGetTransferDetails).toHaveBeenCalledWith('test-id', 'token123');
    expect(mockGetAvailableChunks).toHaveBeenCalledWith('test-id', 'token123');
    expect(mockDownloadChunk).toHaveBeenCalledWith('test-id', 0, 'token123');
    expect(mockWritable.write).toHaveBeenCalledWith({ type: 'write', position: 0, data: expect.any(Blob) });
    
    // Server now says chunk 0 and 1 are available
    mockGetAvailableChunks.mockResolvedValue([0, 1]);
    mockDownloadChunk.mockResolvedValue({
      blob: new Blob(['chunk1']),
      checksum: 'mock-sha256'
    });

    // Fast forward next poll
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockDownloadChunk).toHaveBeenCalledWith('test-id', 1, 'token123');
    expect(mockWritable.write).toHaveBeenCalledWith({ type: 'write', position: 50, data: expect.any(Blob) });
    
    // Transfer completes
    expect(progressLogs).toContain('completed');
  });

  it('pauses and stops scheduling', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileName: 'test.txt',
      fileSize: 100,
      chunkSize: 50,
      totalChunks: 2
    });

    mockGetAvailableChunks.mockResolvedValue([0, 1]);
    
    let resolveDownload: any;
    const downloadPromise = new Promise(r => resolveDownload = r);
    mockDownloadChunk.mockReturnValue(downloadPromise);

    await manager.start('test-id', 'token123');
    await vi.runAllTimersAsync();

    // Chunk 0 is pending
    expect(mockDownloadChunk).toHaveBeenCalledTimes(1);

    manager.pause();

    // Now resolve chunk 0
    resolveDownload({ blob: new Blob(['chunk0']), checksum: null });
    await vi.runAllTimersAsync();

    // Should NOT schedule chunk 1 because we are paused
    expect(mockDownloadChunk).toHaveBeenCalledTimes(1);
    
    let status = '';
    manager.onProgress((p) => status = p.status);
    manager.pause(); // force notify
    expect(status).toBe('paused');
  });

  it('reconciles local state across restarts', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileName: 'test.txt',
      fileSize: 100,
      chunkSize: 50,
      totalChunks: 2
    });

    // Force chunk 0 to be downloaded locally by simulating a successful run
    mockGetAvailableChunks.mockResolvedValue([0]);
    mockDownloadChunk.mockResolvedValue({ blob: new Blob(['chunk0']), checksum: null });

    await manager.start('test-id', 'token123');
    await vi.runAllTimersAsync();

    expect(mockDownloadChunk).toHaveBeenCalledWith('test-id', 0, 'token123');
    manager.pause();

    // Create a new manager instance simulating page reload
    const manager2 = new DownloadManager('test-id', 1);
    
    mockGetAvailableChunks.mockResolvedValue([0, 1]); // Server has both
    
    // It should skip chunk 0 because it's in IndexedDB
    await manager2.start('test-id', 'token123');
    await vi.runAllTimersAsync();

    // Chunk 1 should be requested, not Chunk 0
    expect(mockDownloadChunk).toHaveBeenCalledWith('test-id', 1, 'token123');
    expect(mockDownloadChunk).not.toHaveBeenCalledWith('test-id', 0, 'token123', expect.any(Object)); // Wait, mock tracks all calls, it was called once in the previous test on the old manager.
    // Actually, mockDownloadChunk was called 1 time in manager 1, so total times = 2.
    expect(mockDownloadChunk).toHaveBeenCalledTimes(2); 
    
    manager2.pause();
  });

  it('fails on checksum mismatch and does not write to disk', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1
    });

    mockGetAvailableChunks.mockResolvedValue([0]);
    
    mockDownloadChunk.mockResolvedValue({
      blob: new Blob(['bad_data']),
      checksum: 'wrong-checksum'
    });

    await manager.start('test-id');
    await vi.runAllTimersAsync();

    expect(mockWritable.write).not.toHaveBeenCalled();
    
    let error: any;
    manager.onProgress((p) => error = p.error);
    manager.pause(); // trigger notify
    expect(error?.message).toContain('Checksum mismatch');
  });

  it('stops polling and completes locally when all chunks are downloaded, even if server is UPLOADING (Abandoned Sender)', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileSize: 100,
      chunkSize: 50,
      totalChunks: 2,
      status: 'UPLOADING' // Explicitly showing server is NOT complete
    });

    mockGetAvailableChunks.mockResolvedValue([0, 1]);
    mockDownloadChunk.mockResolvedValue({ blob: new Blob(['data']), checksum: null });

    let status = '';
    manager.onProgress((p) => status = p.status);
    
    await manager.start('test-id');
    await vi.runAllTimersAsync();

    expect(status).toBe('completed');
    
    // Fast forward to ensure no more polling happens
    mockGetAvailableChunks.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockGetAvailableChunks).not.toHaveBeenCalled();
  });

  it('handles TRANSFER_EXPIRED cleanly during polling backstop', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1,
      status: 'UPLOADING'
    });

    // Start with empty chunks
    mockGetAvailableChunks.mockResolvedValue([]);
    await manager.start('test-id');
    
    let state = '';
    let errorMsg = '';
    manager.onProgress((p) => {
        state = p.status;
        if (p.error) errorMsg = p.error.message;
    });

    // Next poll throws TRANSFER_EXPIRED
    mockGetAvailableChunks.mockRejectedValue(new Error('TRANSFER_EXPIRED'));
    await vi.advanceTimersByTimeAsync(3000);

    expect(state).toBe('error');
    expect(errorMsg).toBe('TRANSFER_EXPIRED');

    // Ensure polling has stopped
    mockGetAvailableChunks.mockClear();
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockGetAvailableChunks).not.toHaveBeenCalled();
  });

  it('handles connection loss gracefully during chunk download', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileSize: 100,
      chunkSize: 50,
      totalChunks: 2,
    });

    mockGetAvailableChunks.mockResolvedValue([0]);
    
    // Reject download with network error
    mockDownloadChunk.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await manager.start('test-id');
    await vi.runAllTimersAsync();

    expect(mockWritable.write).not.toHaveBeenCalled(); // nothing written

    let error: any;
    let status = '';
    manager.onProgress((p) => {
      error = p.error;
      status = p.status;
    });
    manager.pause(); // force notify

    expect(status).toBe('error');
    expect(error?.message).toContain('Failed to fetch');
  });

  it('resumes properly after connection loss using reconciliation', async () => {
    mockGetTransferDetails.mockResolvedValue({
      transferId: 'test-id',
      fileSize: 100,
      chunkSize: 50,
      totalChunks: 2,
    });

    // Assume Chunk 0 was successfully written to IDB before a previous crash
    mockGetAvailableChunks.mockResolvedValue([0, 1]);
    mockDownloadChunk.mockResolvedValueOnce({ blob: new Blob(['chunk1']), checksum: null });

    // Let's pretend chunk 0 is locally complete in IndexedDB.
    // Instead of mocking IDB deeply, let's let manager run with a successful chunk0 download, 
    // then error on chunk1.
    mockDownloadChunk.mockResolvedValueOnce({ blob: new Blob(['chunk0']), checksum: null });
    mockDownloadChunk.mockRejectedValueOnce(new TypeError('Network Error'));

    await manager.start('test-id');
    await vi.runAllTimersAsync();

    // Chunk 0 was written, chunk 1 failed
    expect(mockWritable.write).toHaveBeenCalledTimes(1); 
    
    let state = '';
    manager.onProgress((p) => state = p.status);
    manager.pause();
    expect(state).toBe('error');

    // Fix the network for chunk 1
    mockDownloadChunk.mockResolvedValueOnce({ blob: new Blob(['chunk1']), checksum: null });
    
    // Resume!
    await manager.resume();
    await vi.runAllTimersAsync();

    // Only chunk 1 should be written on resume!
    expect(mockDownloadChunk).toHaveBeenCalledWith('test-id', 1, undefined);
    expect(mockWritable.write).toHaveBeenCalledTimes(2); // total writes
    
    expect(state).toBe('completed');
  });
});
