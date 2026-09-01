import React from 'react';

export const LandingPage: React.FC<{ navigate: (path: string) => void }> = ({ navigate }) => {
  return (
    <div className="flex-col flex-center" style={{ flex: 1 }}>
      <div className="header" style={{ textAlign: 'center' }}>
        <h1 className="title-large">Antigravity Transfer</h1>
        <p className="subtitle">Secure, progressive large file sharing.</p>
      </div>

      <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div className="glass-panel floating" style={{ width: '320px', textAlign: 'center', cursor: 'pointer' }} onClick={() => navigate('/send')}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📤</div>
          <h2>SEND</h2>
          <p style={{ opacity: 0.8 }}>Upload and share large files securely.</p>
        </div>

        <div className="glass-panel floating" style={{ width: '320px', textAlign: 'center', cursor: 'pointer' }} onClick={() => navigate('/receive')}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📥</div>
          <h2>RECEIVE</h2>
          <p style={{ opacity: 0.8 }}>Download files shared with you.</p>
        </div>
      </div>
    </div>
  );
};
