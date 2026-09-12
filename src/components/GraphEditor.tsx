import { useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react';
import {
  getOperatorDefinition,
  tryCompileGraph,
  validateConnection,
  type ConnectionValidation,
  type GraphDocument,
  type GraphEndpoint,
  type GraphParamValue,
  type GraphPosition,
} from '../graph';
import { OperatorNode, type OperatorFlowNode } from './OperatorNode';
import {
  OperatorInputRuntimeContext,
  type OperatorInputRuntime,
} from './operatorInputRuntime';
import { OPERATOR_META } from './operatorMeta';

interface GraphEditorProps {
  document: GraphDocument;
  selectedNodeId: string | null;
  playing: boolean;
  inputRuntime: OperatorInputRuntime;
  onMoveNode: (nodeId: string, position: GraphPosition) => void;
  onDeleteNode: (nodeId: string) => void;
  onDisconnect: (edgeId: string) => void;
  onConnect: (source: GraphEndpoint, target: GraphEndpoint) => ConnectionValidation;
  onSelectNode: (nodeId: string | null) => void;
  onParamChange: (
    nodeId: string,
    paramId: string,
    value: GraphParamValue,
  ) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onConnectionRejected: (message: string) => void;
}

const NODE_TYPES = { operator: OperatorNode };

function finalConnectionEndpoints(
  state: FinalConnectionState,
): { source: GraphEndpoint; target: GraphEndpoint } | null {
  const { fromHandle, toHandle } = state;
  const fromPortId = fromHandle?.id;
  const toPortId = toHandle?.id;
  if (!fromPortId || !toPortId || fromHandle.type === toHandle.type) {
    return null;
  }

  const source = fromHandle.type === 'source' ? fromHandle : toHandle;
  const target = fromHandle.type === 'target' ? fromHandle : toHandle;
  return {
    source: {
      nodeId: source.nodeId,
      portId: fromHandle.type === 'source' ? fromPortId : toPortId,
    },
    target: {
      nodeId: target.nodeId,
      portId: fromHandle.type === 'target' ? fromPortId : toPortId,
    },
  };
}

export function GraphEditor({
  document,
  selectedNodeId,
  playing,
  inputRuntime,
  onMoveNode,
  onDeleteNode,
  onDisconnect,
  onConnect,
  onSelectNode,
  onParamChange,
  onGestureStart,
  onGestureEnd,
  onConnectionRejected,
}: GraphEditorProps) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const reconnectingEdgeId = useRef<string | null>(null);
  const activeSelectedEdgeId = document.edges.some((edge) => edge.id === selectedEdgeId)
    ? selectedEdgeId
    : null;

  const reachable = useMemo(() => {
    const compilation = tryCompileGraph(document);
    return compilation.ok
      ? compilation.graph.reachableNodeIds
      : new Set(document.nodes.map((node) => node.id));
  }, [document]);

  const nodes = useMemo<OperatorFlowNode[]>(
    () =>
      document.nodes.map((node) => ({
        id: node.id,
        type: 'operator',
        position: node.position,
        selected: node.id === selectedNodeId,
        data: {
          kind: node.kind,
          params: node.params,
          reachable: reachable.has(node.id),
          onParamChange,
          onGestureStart,
          onGestureEnd,
          onSelect: () => {
            setSelectedEdgeId(null);
            onSelectNode(node.id);
          },
        },
      })),
    [
      document.nodes,
      onGestureEnd,
      onGestureStart,
      onParamChange,
      onSelectNode,
      reachable,
      selectedNodeId,
    ],
  );

  const edges = useMemo<Edge[]>(
    () =>
      document.edges.map((edge) => {
        const sourceNode = document.nodes.find((node) => node.id === edge.source.nodeId);
        const sourcePort = sourceNode
          ? getOperatorDefinition(sourceNode.kind).outputs.find(
              (port) => port.id === edge.source.portId,
            )
          : undefined;
        const color =
          sourcePort?.type === 'control.f32'
            ? '#d8ff5f'
            : sourcePort?.type === 'text.utf8'
              ? '#ffcf6a'
              : '#65ddff';
        return {
          id: edge.id,
          source: edge.source.nodeId,
          sourceHandle: edge.source.portId,
          target: edge.target.nodeId,
          targetHandle: edge.target.portId,
          type: 'smoothstep',
          animated: playing && reachable.has(edge.target.nodeId),
          selected: edge.id === activeSelectedEdgeId,
          reconnectable: true,
          focusable: true,
          deletable: true,
          style: { stroke: color, opacity: reachable.has(edge.target.nodeId) ? 0.78 : 0.24 },
        };
      }),
    [activeSelectedEdgeId, document.edges, document.nodes, playing, reachable],
  );

  const connectionEndpoints = (
    connection: {
      source: string | null;
      target: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ): { source: GraphEndpoint; target: GraphEndpoint } | null => {
    if (
      !connection.source ||
      !connection.target ||
      !connection.sourceHandle ||
      !connection.targetHandle
    ) {
      return null;
    }
    return {
      source: { nodeId: connection.source, portId: connection.sourceHandle },
      target: { nodeId: connection.target, portId: connection.targetHandle },
    };
  };

  const handleConnect = (connection: Connection) => {
    const endpoints = connectionEndpoints(connection);
    if (!endpoints) {
      return;
    }
    const result = onConnect(endpoints.source, endpoints.target);
    if (!result.valid) {
      onConnectionRejected(result.message ?? 'That connection is not valid.');
    }
  };

  const isValidConnection = (connection: Edge | Connection): boolean => {
    const endpoints = connectionEndpoints(connection);
    const ignoredEdgeId = reconnectingEdgeId.current;
    const validationDocument = ignoredEdgeId
      ? {
          ...document,
          edges: document.edges.filter((edge) => edge.id !== ignoredEdgeId),
        }
      : document;
    return endpoints
      ? validateConnection(validationDocument, endpoints.source, endpoints.target).valid
      : false;
  };

  const handleConnectionEnd = (
    _event: MouseEvent | TouchEvent,
    state: FinalConnectionState,
  ) => {
    if (state.isValid === true) {
      return;
    }

    const endpoints = finalConnectionEndpoints(state);
    const ignoredEdgeId = reconnectingEdgeId.current;
    const validationDocument = ignoredEdgeId
      ? {
          ...document,
          edges: document.edges.filter((edge) => edge.id !== ignoredEdgeId),
        }
      : document;
    const validation = endpoints
      ? validateConnection(validationDocument, endpoints.source, endpoints.target)
      : null;
    onConnectionRejected(
      validation?.message ?? 'Connection rejected. Drop on a compatible input port.',
    );
  };

  const handleReconnect = (oldEdge: Edge, connection: Connection) => {
    const endpoints = connectionEndpoints(connection);
    if (!endpoints) {
      onConnectionRejected('Connection rejected. Both ports are required.');
      return;
    }

    const documentWithoutOldEdge = {
      ...document,
      edges: document.edges.filter((edge) => edge.id !== oldEdge.id),
    };
    const validation = validateConnection(
      documentWithoutOldEdge,
      endpoints.source,
      endpoints.target,
    );
    if (!validation.valid) {
      onConnectionRejected(validation.message ?? 'That connection is not valid.');
      return;
    }

    onDisconnect(oldEdge.id);
    const result = onConnect(endpoints.source, endpoints.target);
    if (!result.valid) {
      onConnectionRejected(result.message ?? 'That connection is not valid.');
      return;
    }
    setSelectedEdgeId(null);
  };

  const handleReconnectStart = (
    _event: React.MouseEvent,
    edge: Edge,
  ) => {
    reconnectingEdgeId.current = edge.id;
    onGestureStart();
  };

  const handleReconnectEnd = () => {
    reconnectingEdgeId.current = null;
    onGestureEnd();
  };

  const handleNodeChanges = (changes: NodeChange<OperatorFlowNode>[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        onMoveNode(change.id, change.position);
      } else if (change.type === 'remove') {
        onDeleteNode(change.id);
      }
    }
  };

  const handleEdgeChanges = (changes: EdgeChange<Edge>[]) => {
    for (const change of changes) {
      if (change.type === 'select') {
        setSelectedEdgeId((current) =>
          change.selected ? change.id : current === change.id ? null : current,
        );
      } else if (change.type === 'remove') {
        setSelectedEdgeId((current) => (current === change.id ? null : current));
        onDisconnect(change.id);
      }
    }
  };

  return (
    <div className="graph-stage" aria-label="Visual graph editor">
      <div className={`graph-overlay ${playing ? '' : 'paused'}`}>
        <span className="live-dot" />
        {playing ? 'LIVE PATCH' : 'PATCH PAUSED'}
        <span>·</span>
        <span>{document.nodes.length} nodes</span>
        <span>·</span>
        <span>{document.edges.length} links</span>
      </div>
      <OperatorInputRuntimeContext.Provider value={inputRuntime}>
        <ReactFlow<OperatorFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodeChanges}
          onEdgesChange={handleEdgeChanges}
          onConnect={handleConnect}
          onConnectEnd={handleConnectionEnd}
          onReconnect={handleReconnect}
          onReconnectStart={handleReconnectStart}
          onReconnectEnd={handleReconnectEnd}
          isValidConnection={isValidConnection}
          onNodeClick={(_, node) => {
            setSelectedEdgeId(null);
            onSelectNode(node.id);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
            onSelectNode(null);
          }}
          onPaneClick={() => {
            setSelectedEdgeId(null);
            onSelectNode(null);
          }}
          onNodeDragStart={onGestureStart}
          onNodeDragStop={(_, node) => {
            onMoveNode(node.id, node.position);
            onGestureEnd();
          }}
          deleteKeyCode={['Backspace', 'Delete']}
          connectionLineStyle={{ stroke: '#d8ff5f', strokeWidth: 2 }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.45, maxZoom: 1.05 }}
          minZoom={0.3}
          maxZoom={1.8}
          snapToGrid
          snapGrid={[12, 12]}
          colorMode="dark"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => {
              const data = node.data as OperatorFlowNode['data'];
              return OPERATOR_META[data.kind].accent;
            }}
            maskColor="rgba(4, 6, 9, 0.68)"
          />
        </ReactFlow>
      </OperatorInputRuntimeContext.Provider>
    </div>
  );
}
