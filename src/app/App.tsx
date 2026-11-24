import { HashRouter } from 'react-router-dom';
import Providers from './providers';
import AppRoutes from './router';
import Shell from './Shell';

export default function App() {
  return (
    <HashRouter>
      <Providers>
        <Shell>
          <AppRoutes />
        </Shell>
      </Providers>
    </HashRouter>
  );
}
