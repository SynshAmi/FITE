import React, { useState, useEffect, useRef } from 'react';
import { UploadManager } from '../lib/uploadManager';
import type { TransferProgress } from '../types';

export const SendPage: React.FC<{ onHome: () => void }> = ({ onHome }) => {
  const [manager] = useState(() => new UploadManager(3));
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    manager.onProgress((p) => {
      setProgress({ ...p });
    });
  }, [manager]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      manager.start(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      manager.start(e.dataTransfer.files[0]);
    }
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
              <div 
                className="drop-hub" 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <span style={{ fontSize: '48px' }}>🚀</span>
                <h3 style={{ marginTop: '16px' }}>Drop file to send</h3>
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
