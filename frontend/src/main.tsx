import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createUserManager } from './auth';
import { loadConfig } from './config';
import { createQueryClient } from './todos';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('#root is missing from index.html');
const root = createRoot(container);

loadConfig().then(
  (config) => {
    root.render(
      <StrictMode>
        <App
          config={config}
          userManager={createUserManager(config)}
          queryClient={createQueryClient()}
        />
      </StrictMode>,
    );
  },
  (error: unknown) => {
    console.error(error);
    root.render(
      <main className="centered">
        <h1>Todos</h1>
        <p role="alert">The app is not configured correctly. Please try again later.</p>
      </main>,
    );
  },
);
