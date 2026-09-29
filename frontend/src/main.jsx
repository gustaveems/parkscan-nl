import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { isDemoHost, installDemoFetch } from './lib/demo/demoRuntime.js';
import App from './App';
import './index.css';

const DEMO = isDemoHost();
if (DEMO) installDemoFetch();

const basename =
  typeof document !== 'undefined' && document.baseURI?.includes('/parkscan-nl/')
    ? '/parkscan-nl'
    : '/';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
