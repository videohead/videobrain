import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphDocument } from '../graph';

interface UsePollingGraphOptions {
  /** Polling API base URL (e.g., http://localhost:8934) */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Polling interval in ms (default: 1000) */
  intervalMs?: number;
  /** Callback when graph is received */
  onGraphChange?: (graph: GraphDocument) => void;
  /** Callback when control events are received */
  onControlEvents?: (events: ControlEvent[]) => void;
}

interface ControlEvent {
  id: string;
  mappingId: string;
  event: { type: 'press' | 'release' | 'value'; value?: number };
  timestamp: string;
  requestId: string;
}

export function usePollingGraph({
  baseUrl,
  apiKey,
  intervalMs = 1000,
  onGraphChange,
  onControlEvents,
}: UsePollingGraphOptions) {
  const [connected, setConnected] = useState(false);
  const [graph, setGraph] = useState<GraphDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);
  const etagRef = useRef<string | null>(null);
  const eventCursorRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchGraph = useCallback(async () => {
    abortControllerRef.current = new AbortController();
    try {
      const headers: Record<string, string> = {
        'X-Api-Key': apiKey,
      };
      const currentEtag = etagRef.current;
      if (currentEtag) {
        headers['If-None-Match'] = currentEtag;
      }
      const res = await window.fetch(`${baseUrl}/api/graph`, {
        method: 'GET',
        headers,
        signal: abortControllerRef.current?.signal,
      });
      if (res.status === 304) {
        // Not modified
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: { graph: GraphDocument; timestamp: string } = await res.json();
      const etag = res.headers.get('ETag');
      if (etag !== null) etagRef.current = etag;
      setGraph(data.graph);
      setConnected(true);
      setError(null);
      onGraphChange?.(data.graph);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
        setConnected(false);
      }
    }
  }, [baseUrl, apiKey, onGraphChange]);

  const fetchEvents = useCallback(async () => {
    try {
      const headers: Record<string, string> = {
        'X-Api-Key': apiKey,
      };
      // Use cursor for pagination
      const currentCursor = eventCursorRef.current;
      if (currentCursor) {
        headers['If-None-Match'] = currentCursor;
      }
      const res = await window.fetch(`${baseUrl}/api/control/events`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) return;
      const data: { events: Array<{ id: string; mappingId: string; event: { type: 'press' | 'release' | 'value'; value?: number }; timestamp: string; requestId: string }> } = await res.json();
      if (data.events.length > 0) {
        const lastEvent = data.events.at(-1);
        if (!lastEvent) return;
        eventCursorRef.current = lastEvent.id;
        onControlEvents?.(data.events);
      }
    } catch {
      // Ignore polling errors
    }
  }, [baseUrl, apiKey, onControlEvents]);

  const applyGraph = useCallback(async (graph: GraphDocument) => {
    try {
      const res = await window.fetch(`${baseUrl}/api/graph`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(graph),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply graph');
      return false;
    }
  }, [baseUrl, apiKey]);

  const patchGraph = useCallback(async (patch: { nodes?: any[]; edges?: any[] }) => {
    try {
      const res = await window.fetch(`${baseUrl}/api/graph/patch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to patch graph');
      return false;
    }
  }, [baseUrl, apiKey]);

  const sendControlEvent = useCallback(async (mappingId: string, event: { type: 'press' | 'release' | 'value'; value?: number }, requestId?: string) => {
    try {
      const res = await window.fetch(`${baseUrl}/api/control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({ mappingId, event, requestId: requestId || crypto.randomUUID() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send control event');
      return false;
    }
  }, [baseUrl, apiKey]);

  // Start polling
  useEffect(() => {
    const doPoll = async () => {
      await fetchGraph();
      await fetchEvents();
    };
    doPoll();
    intervalRef.current = window.setInterval(doPoll, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortControllerRef.current?.abort();
    };
  }, [fetchGraph, fetchEvents, intervalMs]);

  return {
    connected,
    graph,
    error,
    applyGraph,
    patchGraph,
    sendControlEvent,
    refetch: fetchGraph,
  };
}