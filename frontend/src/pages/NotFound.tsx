import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="text-center">
        <h1 className="text-9xl font-bold font-mono text-[var(--accent-primary)] mb-4">404</h1>
        <h2 className="text-2xl font-semibold mb-2">Page Not Found</h2>
        <p className="text-[var(--text-muted)] mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to="/dashboard" className="btn btn-primary">
            <Home className="w-4 h-4" />
            Go to Dashboard
          </Link>
          <button onClick={() => window.history.back()} className="btn btn-secondary">
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}
