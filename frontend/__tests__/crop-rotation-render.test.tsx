import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CropRotation } from '../src/pages/CropRotation';
import { Layout } from '../src/components/Layout';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { LanguageProvider } from '../src/contexts/LanguageContext';

describe('CropRotation Page SSR / Mount Test', () => {
  it('renders CropRotation without crashing', () => {
    const html = renderToString(
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={['/crop-rotation']}>
            <CropRotation />
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>
    );
    expect(html).toContain('جارٍ تقييم استراتيجيات الدورة الزراعية');
  });

  it('renders Layout containing CropRotation without crashing', () => {
    const html = renderToString(
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={['/crop-rotation']}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="crop-rotation" element={<CropRotation />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>
    );
    expect(html).toBeDefined();
  });
});
