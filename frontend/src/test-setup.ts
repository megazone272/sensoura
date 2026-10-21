// Setup localStorage for tests
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: (key: string) => localStorageMock.store[key] ?? null,
  setItem: (key: string, value: string) => { localStorageMock.store[key] = value; },
  removeItem: (key: string) => { delete localStorageMock.store[key]; },
  clear: () => { localStorageMock.store = {}; },
};
(globalThis as any).localStorage = localStorageMock;

// Setup window.matchMedia for Tailwind/dark mode tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: function() {
    return {
      matches: false,
      media: () => window.matchMedia('') as any,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
  },
});

