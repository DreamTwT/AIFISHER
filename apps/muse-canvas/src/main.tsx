import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/canvas.css';
import './styles/nodes.css';
import './styles/panels.css';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
