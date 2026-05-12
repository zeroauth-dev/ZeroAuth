import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="text-7xl font-bold text-[var(--color-text-dim)]">404</div>
      <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        The page you were looking for doesn't exist.
      </p>
      <Link to="/overview" className="mt-6">
        <Button>Back to overview</Button>
      </Link>
    </div>
  );
}
