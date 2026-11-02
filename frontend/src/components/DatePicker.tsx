import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Language } from '@services/language';

type DatePickerProps = {
  label: string;
  value: string;
  language: Language;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
};

function toDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toDateValue(date) === value ? date : null;
}

export function DatePicker({ label, value, language, min, max, onChange }: DatePickerProps) {
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB';
  const copy = language === 'ar'
    ? { choose: 'اختر تاريخًا', calendar: 'تقويم التاريخ', previous: 'الشهر السابق', next: 'الشهر التالي' }
    : { choose: 'Choose a date', calendar: 'Date picker', previous: 'Previous month', next: 'Next month' };
  const selectedDate = fromDateValue(value);
  const minDate = min ? fromDateValue(min) : null;
  const maxDate = max ? fromDateValue(max) : null;
  const minimumValue = minDate ? toDateValue(minDate) : undefined;
  const maximumValue = maxDate ? toDateValue(maxDate) : undefined;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = selectedDate ?? new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarId = useId();

  useEffect(() => {
    if (open) {
      const date = fromDateValue(value) ?? new Date();
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthTitle = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(visibleMonth);
  const selectedLabel = selectedDate
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(selectedDate)
    : copy.choose;
  const todayValue = toDateValue(new Date());
  const weekDays = useMemo(() => {
    const sunday = new Date(2026, 1, 1);
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + index)));
  }, [locale]);
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    return Array.from({ length: 42 }, (_, index) => new Date(year, month, index - firstDay.getDay() + 1));
  }, [year, month]);

  const previousMonthEnd = toDateValue(new Date(year, month, 0));
  const nextMonthStart = toDateValue(new Date(year, month + 1, 1));
  const canGoPrevious = !min || previousMonthEnd >= min;
  const canGoNext = !max || nextMonthStart <= max;
  const PreviousIcon = language === 'ar' ? ChevronRight : ChevronLeft;
  const NextIcon = language === 'ar' ? ChevronLeft : ChevronRight;

  const chooseDate = (date: Date) => {
    const nextValue = toDateValue(date);
    if ((min && nextValue < min) || (max && nextValue > max)) return;
    onChange(nextValue);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="date-picker" ref={rootRef} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <span className="date-picker-label">{label}</span>
      <button
        ref={triggerRef}
        id={`${calendarId}-trigger`}
        className="date-picker-trigger"
        type="button"
        aria-label={`${label}: ${selectedLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={calendarId}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{selectedLabel}</span>
      </button>
      <div id={calendarId} className="date-picker-popover" role="dialog" aria-label={`${label} — ${copy.calendar}`} hidden={!open}>
        <div className="date-picker-header">
          <button
            className="date-picker-nav"
            type="button"
            aria-label={copy.previous}
            disabled={!canGoPrevious}
            onClick={() => setVisibleMonth(new Date(year, month - 1, 1))}
          >
            <PreviousIcon size={17} aria-hidden="true" />
          </button>
          <strong aria-live="polite">{monthTitle}</strong>
          <button
            className="date-picker-nav"
            type="button"
            aria-label={copy.next}
            disabled={!canGoNext}
            onClick={() => setVisibleMonth(new Date(year, month + 1, 1))}
          >
            <NextIcon size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="date-picker-weekdays" aria-hidden="true">
          {weekDays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div className="date-picker-days">
          {calendarDays.map((date) => {
            const dateValue = toDateValue(date);
            const isOutsideMonth = date.getMonth() !== month;
            const isDisabled = (minimumValue !== undefined && dateValue < minimumValue)
              || (maximumValue !== undefined && dateValue > maximumValue);
            const isSelected = dateValue === value;
            const classes = [
              'date-picker-day',
              isOutsideMonth ? 'is-outside-month' : '',
              dateValue === todayValue ? 'is-today' : '',
              isSelected ? 'is-selected' : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                key={dateValue}
                className={classes}
                type="button"
                disabled={isDisabled}
                aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date)}
                aria-pressed={isSelected}
                onClick={() => chooseDate(date)}
              >
                {new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
