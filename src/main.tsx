import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';
import { startControlBridge } from './controlBridge';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root is missing.');
}

const controlBridgeUrl = import.meta.env.VITE_CONTROL_BRIDGE_URL;
if (controlBridgeUrl) startControlBridge(controlBridgeUrl);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
