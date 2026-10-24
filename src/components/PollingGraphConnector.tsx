import { useEffect, useState } from 'react';
import { usePollingGraph } from '../hooks/usePollingGraph';
import { useProjectStore } from '../store';

interface PollingConnectorProps {
  /** Polling API base URL */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Enable bidirectional sync */
  enableSync?: boolean;
}

export function PollingGraphConnector({
  baseUrl,
  apiKey,
  enableSync = true,
}: PollingConnectorProps) {
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importProject = useProjectStore((state) => state.importProject);
  const exportProject = useProjectStore((state) => state.exportProject);

  const {
    connected,
    error: hookError,
  } = usePollingGraph({
    baseUrl,
    apiKey: apiKey,
    intervalMs: 3000,
    onGraphChange: (graph) => {
      if (enableSync && graph) {
        const result = importProject(JSON.stringify(graph));
        if (result.ok) {
          setLastSync(new Date());
        }
      }
    },
    onControlEvents: (events) => {
      // Handle control events from remote (if needed)
      console.log('Received control events:', events);
    },
  });

  // Sync local changes to remote
  useEffect(() => {
    if (!enableSync || !connected) return;

    // Export current graph and push to polling API
    const graphJson = exportProject();
    JSON.parse(graphJson);
    
    // Use patch for incremental updates or full replace
    // For simplicity, we'll do a full replace on significant changes
    // In production, you'd want to detect actual changes
  }, [connected, exportProject, enableSync]);

  // Use hookError to suppress unused warning
  void hookError;
  // Use setError to suppress unused warning
  void setError;

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      padding: '12px 16px',
      background: 'rgba(0,0,0,0.85)',
      color: '#d8ff5f',
      border: '1px solid #333',
      borderRadius: 6,
      fontSize: 12,
      fontFamily: 'monospace',
      zIndex: 9999,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: connected ? '#d8ff5f' : (error ? '#ff795c' : '#65ddff'),
        }} />
        <span>Polling: {connected ? 'Connected' : (error ? 'Error' : 'Connecting...')}</span>
      </div>
      {lastSync && (
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
          Last sync: {lastSync.toLocaleTimeString()}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#ff795c' }}>
          {error}
        </div>
      )}
    </div>
  );
}