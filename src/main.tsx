import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';

function BootReporter() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) root.dataset.videobrainBoot = 'mounted';
  }, []);

  return <App />;
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root is missing.');
}

root.dataset.videobrainBoot = 'rendering';

createRoot(root).render(
  <StrictMode>
    <BootReporter />
  </StrictMode>,
);
