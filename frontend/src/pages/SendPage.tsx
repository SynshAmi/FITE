import React, { useState, useEffect, useRef } from 'react';
import { UploadManager } from '../lib/uploadManager';
import { getTransferDetails, getAvailableChunks } from '../api';
import type { TransferProgress, TransferMetadata } from '../types';

const SENDER_ACTIVE_TRANSFER_KEY = 'sender_active_transfer_id';
const SENDER_TRANSFER_PREFIX = 'sender_transfer_';

export const SendPage: React.FC<{ onHome: () => void }> = ({ onHome }) => {
  const [manager] = useState(() => new UploadManager(3));
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [resumableTransfer, setResumableTransfer] = useState<{ metadata: TransferMetadata; uploadedBytes: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    manager.onProgress((p) => {
      setProgress({ ...p });
    });
  }, [manager]);

  // Check for active transfer saved in localStorage upon mount
  useEffect(() => {
    const activeId = localStorage.getItem(SENDER_ACTIVE_TRANSFER_KEY);
    if (activeId) {
      const raw = localStorage.getItem(SENDER_TRANSFER_PREFIX + activeId);
      if (raw) {
        try {
          const meta = JSON.parse(raw) as TransferMetadata;
          getTransferDetails(meta.transferId, meta.shareToken)
            .then(async (details) => {
              if (details.status !== 'EXPIRED' && details.status !== 'FAILED') {
                const chunks = await getAvailableChunks(meta.transferId, meta.shareToken);
                const uploaded = Math.min(chunks.length * details.chunkSize, details.fileSize);
                setResumableTransfer({ metadata: details, uploadedBytes: uploaded });
              } else {
                localStorage.removeItem(SENDER_ACTIVE_TRANSFER_KEY);
                localStorage.removeItem(SENDER_TRANSFER_PREFIX + activeId);
              }
            })
            .catch(() => {
              // Transfer not found or expired on backend
              localStorage.removeItem(SENDER_ACTIVE_TRANSFER_KEY);
              localStorage.removeItem(SENDER_TRANSFER_PREFIX + activeId);
            });
        } catch {
          localStorage.removeItem(SENDER_ACTIVE_TRANSFER_KEY);
          localStorage.removeItem(SENDER_TRANSFER_PREFIX + activeId);
        }
      } else {
        localStorage.removeItem(SENDER_ACTIVE_TRANSFER_KEY);
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const existing = resumableTransfer && resumableTransfer.metadata.fileName === file.name && resumableTransfer.metadata.fileSize === file.size
        ? resumableTransfer.metadata
        : undefined;
      setResumableTransfer(null);
      manager.start(file, existing);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const existing = resumableTransfer && resumableTransfer.metadata.fileName === file.name && resumableTransfer.metadata.fileSize === file.size
        ? resumableTransfer.metadata
        : undefined;
      setResumableTransfer(null);
      manager.start(file, existing);
    }
  };

  const handleDismissResumable = (e: React.MouseEvent) => {
    e.stopPropagation();
    const activeId = localStorage.getItem(SENDER_ACTIVE_TRANSFER_KEY);
    localStorage.removeItem(SENDER_ACTIVE_TRANSFER_KEY);
    if (activeId) {
      localStorage.removeItem(SENDER_TRANSFER_PREFIX + activeId);
    }
    if (resumableTransfer) {
      localStorage.removeItem(SENDER_TRANSFER_PREFIX + resumableTransfer.metadata.transferId);
    }
    setResumableTransfer(null);
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  };

  return (
    <div className="flex-col" style={{ flex: 1, alignItems: 'center', paddingTop: '40px' }}>
      <div style={{ width: '100%', maxWidth: '600px' }}>
        <button className="btn secondary" onClick={onHome} style={{ marginBottom: '24px' }}>← Back</button>
        
        <div className="glass-panel floating">
          {!progress || progress.status === 'idle' ? (
            <div>
              <h2 style={{ textAlign: 'center', marginBottom: '32px' }}>Upload File</h2>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
              
              {resumableTransfer && (
                <div style={{
                  marginBottom: '20px',
                  padding: '16px',
                  background: 'rgba(0, 238, 252, 0.08)',
                  border: '1px solid var(--secondary)',
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong>Resume Active Transfer</strong>
                    <button className="btn secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleDismissResumable}>
                      Start New
                    </button>
                  </div>
                  <div style={{ fontSize: '14px', marginBottom: '6px' }}>{resumableTransfer.metadata.fileName}</div>
                  <div className="text-mono" style={{ fontSize: '12px', color: 'var(--secondary)' }}>
                    Saved progress: {formatBytes(resumableTransfer.uploadedBytes)} / {formatBytes(resumableTransfer.metadata.fileSize)}
                  </div>
                  <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '8px' }}>
                    Select or drop <strong>{resumableTransfer.metadata.fileName}</strong> below to continue uploading without restarting.
                  </div>
                </div>
              )}

              <div 
                className="drop-hub" 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <span style={{ fontSize: '48px' }}>🚀</span>
                <h3 style={{ marginTop: '16px' }}>
                  {resumableTransfer ? `Select ${resumableTransfer.metadata.fileName} to Resume` : 'Drop file to send'}
                </h3>
                <span className="text-mono">Up to 20 GB</span>
              </div>
            </div>
          ) : (
            <div className="flex-col" style={{ gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: '0 0 8px 0' }}>{progress.metadata?.fileName || 'Uploading...'}</h3>
                  <span className="text-mono">{formatBytes(progress.transferredBytes)} / {formatBytes(progress.totalBytes)}</span>
                </div>
                <span className={`status-badge ${progress.status === 'error' ? 'error' : progress.status === 'completed' ? 'success' : ''}`}>
                  {progress.status}
                </span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '999px', height: '12px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${progress.progress}%`,
                  background: progress.status === 'error' ? 'var(--error)' : progress.status === 'completed' ? 'var(--success)' : 'linear-gradient(90deg, var(--primary), var(--secondary))',
                  transition: 'width 0.3s'
                }}></div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div className="text-mono" style={{ fontSize: '24px', color: 'var(--secondary)' }}>
                  {progress.progress}%
                </div>
                <div>
                  {(progress.status === 'progressing' || progress.status === 'starting') && (
                    <button className="btn secondary" onClick={() => manager.pause()}>Pause</button>
                  )}
                  {progress.status === 'paused' && (
                    <button className="btn" onClick={() => manager.resume()}>Resume</button>
                  )}
                </div>
              </div>

              {progress.metadata && progress.status !== 'error' && (
                <div className="copy-box">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: '4px' }}>Share Link</div>
                    <input 
                      readOnly 
                      value={`${window.location.origin}/download/${progress.metadata.transferId}?token=${progress.metadata.shareToken}`} 
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                  <button className="btn" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/download/${progress.metadata!.transferId}?token=${progress.metadata!.shareToken}`)}>Copy</button>
                </div>
              )}

              {progress.status === 'error' && (
                <div style={{ padding: '16px', background: 'var(--error-bg)', color: 'var(--error)', borderRadius: '8px' }}>
                  {progress.error?.message || 'An unknown error occurred.'}
                  <div style={{ marginTop: '16px' }}>
                     <button className="btn" onClick={() => manager.resume()}>Retry</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
