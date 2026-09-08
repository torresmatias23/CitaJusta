import { BrowserRouter } from 'react-router';
import { AppRoutes } from '../routes/app-routes';

export function App() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
