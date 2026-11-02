import { useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function PageMotion({ children, className = '' }: { children: ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (reducedMotion() || !scope.current) return;
    const items = scope.current.querySelectorAll<HTMLElement>('[data-motion-item]');
    if (!items.length) return;
    items.forEach((item, index) => {
      gsap.fromTo(item,
        { autoAlpha: 0, y: 16, filter: 'blur(3px)' },
        {
          autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.48, delay: Math.min(index * 0.025, 0.15),
          ease: 'power2.out', clearProps: 'filter,transform',
          scrollTrigger: { trigger: item, start: 'top 90%', once: true },
        },
      );
    });
  }, { scope, dependencies: [], revertOnUpdate: true });

  return <div ref={scope} className={className}>{children}</div>;
}

export function RevealOnScroll({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const element = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const node = element.current;
    if (!node || reducedMotion()) return;
    gsap.fromTo(node, { autoAlpha: 0, y: 18 }, {
      autoAlpha: 1, y: 0, duration: 0.55, delay, ease: 'power2.out', clearProps: 'transform',
      scrollTrigger: { trigger: node, start: 'top 90%', once: true },
    });
  }, { scope: element, dependencies: [delay], revertOnUpdate: true });

  return <div ref={element} className={className}>{children}</div>;
}

export function AnimatedNumber({ value, digits = 1, locale }: { value: number | null | undefined; digits?: number; locale: string }) {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);

  useGSAP(() => {
    const element = node.current;
    if (!element) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      element.textContent = '—';
      return;
    }
    const format = (number: number) => number.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (reducedMotion()) {
      element.textContent = format(value);
      previous.current = value;
      return;
    }
    const counter = { current: previous.current };
    const tween = gsap.to(counter, {
      current: value,
      duration: 0.65,
      ease: 'power2.out',
      onUpdate: () => { if (node.current) node.current.textContent = format(counter.current); },
      onComplete: () => { previous.current = value; },
    });
    return () => tween.kill();
  }, { dependencies: [value, digits, locale], revertOnUpdate: true });

  return <span ref={node} className="tabular-nums">{typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'}</span>;
}
