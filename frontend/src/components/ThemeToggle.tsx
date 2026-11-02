import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

type ThemeToggleProps = {
  language?: 'ar' | 'en';
  compact?: boolean;
};

export function ThemeToggle({ language = 'en', compact = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isArabic = language === 'ar';
  const nextMode = theme === 'dark' ? 'light' : 'dark';
  const label = isArabic
    ? (nextMode === 'light' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن')
    : (nextMode === 'light' ? 'Switch to light mode' : 'Switch to dark mode');
  const Icon = theme === 'dark' ? Sun : Moon;
  const text = isArabic
    ? (nextMode === 'light' ? 'فاتح' : 'داكن')
    : (nextMode === 'light' ? 'Light' : 'Dark');

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {!compact && <span>{text}</span>}
    </button>
  );
}
