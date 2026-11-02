import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// No StrictMode: its double-mounted effects would create two WebGL renderers
// and two game loops in development. Game.dispose() is still idempotent.
createRoot(document.getElementById('root')!).render(<App />);
