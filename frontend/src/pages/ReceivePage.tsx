import React, { useState, useEffect } from 'react';
import { DownloadManager } from '../lib/downloadManager';
import type { TransferProgress } from '../types';

export const ReceivePage: React.FC<{ onHome: () => void }> = ({ onHome }) => {
  const [manager] = useState(() => new DownloadManager('temp', 3));
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    manager.onProgress((p) => {
      setProgress({ ...p });
    });
  }, [manager]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) return;
    
    let transferId = code;
    let token = '';
    
    try {
      if (code.includes('http')) {
        const url = new URL(code);
        const pathParts = url.pathname.split('/');
        transferId = pathParts[pathParts.length - 1];
        token = url.searchParams.get('token') || '';
      } else if (code.includes('?token=')) {
        const parts = code.split('?token=');
        transferId = parts[0];
        token = parts[1];
      }
    } catch(e) {}

    manager.start(transferId, token);
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
            <form onSubmit={handleStart} className="flex-col" style={{ gap: '24px' }}>
              <h2 style={{ textAlign: 'center', margin: 0 }}>Download File</h2>
              <p style={{ textAlign: 'center', color: 'var(--text-dim)', margin: 0 }}>Enter your transfer code or link</p>
              
              <input 
                className="input" 
                placeholder="e.g. domain.com/download/1234..." 
                value={code} 
                onChange={e => setCode(e.target.value)}
                autoFocus
              />
              
              <button className="btn" type="submit" style={{ width: '100%' }}>Fetch Transfer</button>
            </form>
          ) : (
            <div className="flex-col" style={{ gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: '0 0 8px 0' }}>{progress.metadata?.fileName || 'Fetching Metadata...'}</h3>
                  {progress.metadata && (
                    <span className="text-mono">{formatBytes(progress.transferredBytes)} / {formatBytes(progress.totalBytes)}</span>
                  )}
                </div>
                <span className={`status-badge ${progress.status === 'error' ? 'error' : progress.status === 'completed' ? 'success' : ''}`}>
                  {progress.status}
                </span>
              </div>

              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '999px', height: '12px', overflow: 'hidden' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${progress.progress}%`,
                  background: progress.status === 'error' ? 'var(--error)' : progress.status === 'completed' ? 'var(--success)' : progress.status === 'waiting' ? 'var(--secondary)' : 'linear-gradient(90deg, var(--primary), var(--secondary))',
                  transition: 'width 0.3s'
                }}></div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div className="text-mono" style={{ fontSize: '24px', color: 'var(--secondary)' }}>
                  {progress.progress}%
                </div>
                <div>
                  {(progress.status === 'progressing' || progress.status === 'starting' || progress.status === 'waiting') && (
                    <button className="btn secondary" onClick={() => manager.pause()}>Pause</button>
                  )}
                  {progress.status === 'paused' && (
                    <button className="btn" onClick={() => manager.resume()}>Resume</button>
                  )}
                </div>
              </div>

              {progress.status === 'error' && (
                <div style={{ padding: '16px', background: 'var(--error-bg)', color: 'var(--error)', borderRadius: '8px' }}>
                  {progress.error?.message || 'An unknown error occurred.'}
                  <div style={{ marginTop: '16px' }}>
                     <button className="btn" onClick={() => manager.resume()}>Retry</button>
                  </div>
                </div>
              )}
              
              {progress.status === 'waiting' && (
                <div style={{ padding: '12px', background: 'rgba(0, 238, 252, 0.1)', color: 'var(--secondary)', borderRadius: '8px', fontSize: '14px' }}>
                  Waiting for sender to upload more data...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
