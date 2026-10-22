import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Input } from './Input';
import { Textarea } from './Textarea';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

function ThemeConsumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('light')}>Set Light</button>
    </div>
  );
}

describe('Form Controls, Modal, and Theme', () => {
  describe('Input', () => {
    it('renders with label and helper text', () => {
      render(
        <Input label="Email Address" helperText="Corporate email only" placeholder="name@company.com" />
      );
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByText('Corporate email only')).toBeInTheDocument();
    });

    it('renders error state with role alert', () => {
      render(<Input label="Password" error="Password must be at least 8 characters" />);
      const errorMsg = screen.getByRole('alert');
      expect(errorMsg).toHaveTextContent('Password must be at least 8 characters');
    });
  });

  describe('Textarea', () => {
    it('renders textarea with label and receives user input', () => {
      render(<Textarea label="Prompt" placeholder="Ask a question..." />);
      const textarea = screen.getByLabelText(/prompt/i);
      expect(textarea).toBeInTheDocument();
      fireEvent.change(textarea, { target: { value: 'What is our expense policy?' } });
      expect(textarea).toHaveValue('What is our expense policy?');
    });
  });

  describe('Modal', () => {
    it('does not render when isOpen is false', () => {
      render(
        <Modal isOpen={false} onClose={jest.fn()} title="Test Dialog">
          Modal Body
        </Modal>
      );
      expect(screen.queryByText('Test Dialog')).not.toBeInTheDocument();
    });

    it('renders when isOpen is true and calls onClose on Escape key', () => {
      const handleClose = jest.fn();
      render(
        <Modal isOpen={true} onClose={handleClose} title="Security Modal">
          Confidential Content
        </Modal>
      );
      expect(screen.getByText('Security Modal')).toBeInTheDocument();
      expect(screen.getByText('Confidential Content')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Skeleton', () => {
    it('renders with accessible aria-hidden attribute', () => {
      const { container } = render(<Skeleton className="w-20 h-4" />);
      const skeleton = container.firstChild as HTMLElement;
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      expect(skeleton).toHaveClass('animate-pulse');
    });
  });

  describe('ThemeProvider', () => {
    beforeEach(() => {
      // Mock window.matchMedia
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation((query) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: jest.fn(),
          removeListener: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
        })),
      });
    });

    it('provides theme context and toggles theme', () => {
      render(
        <ThemeProvider defaultTheme="light">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');

      act(() => {
        fireEvent.click(screen.getByText('Set Dark'));
      });

      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });
});
