import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileGraph, type GraphDocument, type GraphNode } from '../graph';
import { StreamInputSession, type StreamInputSettings, type StreamInputState } from '../engine/StreamInputSession';

export interface NetworkVideoStatus {
  state: StreamInputState;
  error: string | null;
}

export interface NetworkVideoRuntime {
  sources: ReadonlyMap<string, HTMLVideoElement>;
  getStatus: (nodeId: string) => NetworkVideoStatus;
  canConnect: (nodeId: string) => boolean;
  connect: (nodeId: string) => void;
  disconnect: (nodeId: string) => void;
}

function settingsFor(node: GraphNode): StreamInputSettings {
  return {
    url: String(node.params.url ?? ''),
    protocol: node.params.protocol === 'whep' ? 'whep' : node.params.protocol === 'dash' ? 'dash' : 'hls',
    stunServer: String(node.params.stunServer ?? ''),
  };
}

export function useNetworkVideo(document: GraphDocument): NetworkVideoRuntime {
  const sessions = useRef(new Map<string, { session: StreamInputSession; key: string }>());
  const [statuses, setStatuses] = useState<ReadonlyMap<string, NetworkVideoStatus>>(new Map());
  const activeNodes = useMemo(() => new Map(
    compileGraph(document).frameNodes.filter(({ node }) => node.kind === 'networkVideo').map(({ node }) => [node.id, node]),
  ), [document]);

  const disconnect = useCallback((nodeId: string) => {
    sessions.current.get(nodeId)?.session.dispose();
    sessions.current.delete(nodeId);
    setStatuses((previous) => {
      const next = new Map(previous);
      next.delete(nodeId);
      return next;
    });
  }, []);

  const connect = useCallback((nodeId: string) => {
    const node = activeNodes.get(nodeId);
    if (!node) return;
    disconnect(nodeId);
    const settings = settingsFor(node);
    const session = new StreamInputSession(settings, (state, error) => {
      if (sessions.current.get(nodeId)?.session !== session) return;
      setStatuses((previous) => new Map(previous).set(nodeId, { state, error }));
    });
    sessions.current.set(nodeId, { session, key: JSON.stringify(settings) });
    void session.start();
  }, [activeNodes, disconnect]);

  useEffect(() => {
    for (const [nodeId, entry] of sessions.current) {
      const node = activeNodes.get(nodeId);
      if (!node || entry.key !== JSON.stringify(settingsFor(node))) disconnect(nodeId);
    }
  }, [activeNodes, disconnect]);

  useEffect(() => {
    const current = sessions.current;
    return () => {
      for (const entry of current.values()) entry.session.dispose();
      current.clear();
    };
  }, []);

  const sources = useMemo(() => {
    const next = new Map<string, HTMLVideoElement>();
    for (const [nodeId, status] of statuses) {
      const video = sessions.current.get(nodeId)?.session.video;
      if (video && (status.state === 'live' || status.state === 'buffering')) next.set(nodeId, video);
    }
    return next;
  }, [statuses]);

  return {
    sources,
    getStatus: (nodeId) => statuses.get(nodeId) ?? { state: 'idle', error: null },
    canConnect: (nodeId) => activeNodes.has(nodeId),
    connect,
    disconnect,
  };
}