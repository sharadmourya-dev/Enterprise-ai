import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Input } from './Input';
import { Textarea } from './Textarea';
import { Modal, ModalFooter } from './Modal';
import { Button } from './Button';
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
      <button onClick={() => setTheme('system')}>Set System</button>
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
    beforeEach(() => {
      document.body.style.overflow = 'unset';
    });

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

    it('locks body scrolling when open and restores it when closed', () => {
      const { rerender } = render(
        <Modal isOpen={true} onClose={jest.fn()} title="Scroll Lock Test">
          <div>Content</div>
        </Modal>
      );
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <Modal isOpen={false} onClose={jest.fn()} title="Scroll Lock Test">
          <div>Content</div>
        </Modal>
      );
      expect(document.body.style.overflow).toBe('unset');
    });

    it('renders scrollable content area with independent overflow', () => {
      render(
        <Modal isOpen={true} onClose={jest.fn()} title="Long Content Modal">
          <div style={{ height: '2000px' }}>Very long policy text</div>
          <ModalFooter>
            <Button>Action Button</Button>
          </ModalFooter>
        </Modal>
      );

      const body = screen.getByTestId('modal-body');
      expect(body).toBeInTheDocument();
      expect(body).toHaveClass('overflow-y-auto');
      expect(body).toHaveClass('flex-1');
      expect(body).toHaveClass('min-h-0');

      const footer = screen.getByTestId('modal-footer');
      expect(footer).toBeInTheDocument();
      expect(footer).toHaveClass('sticky');
      expect(footer).toHaveClass('bottom-0');
      expect(screen.getByRole('button', { name: /Action Button/i })).toBeInTheDocument();
    });

    it('renders pinned footer when footer prop is passed', () => {
      render(
        <Modal
          isOpen={true}
          onClose={jest.fn()}
          title="Pinned Footer Test"
          footer={<Button>Direct Pinned Action</Button>}
        >
          <div>Body content</div>
        </Modal>
      );

      const pinnedFooter = screen.getByTestId('modal-pinned-footer');
      expect(pinnedFooter).toBeInTheDocument();
      expect(pinnedFooter).toHaveClass('shrink-0');
      expect(screen.getByRole('button', { name: /Direct Pinned Action/i })).toBeInTheDocument();
    });

    it('prevents backdrop click and Escape dismissal when preventClose is true', () => {
      const handleClose = jest.fn();
      render(
        <Modal
          isOpen={true}
          onClose={handleClose}
          preventClose={true}
          title="In Flight Operation"
        >
          <div>Saving changes...</div>
        </Modal>
      );

      // Attempt Escape key
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(handleClose).not.toHaveBeenCalled();

      // Attempt backdrop click
      const overlay = screen.getByTestId('modal-overlay');
      fireEvent.click(overlay);
      expect(handleClose).not.toHaveBeenCalled();

      // Close button should be disabled
      const closeBtn = screen.getByLabelText('Close dialog');
      expect(closeBtn).toBeDisabled();
    });

    it('dismisses via backdrop click when enabled and not prevented', () => {
      const handleClose = jest.fn();
      render(
        <Modal
          isOpen={true}
          onClose={handleClose}
          preventClose={false}
          title="Backdrop Test"
        >
          <div>Click outside me</div>
        </Modal>
      );

      const overlay = screen.getByTestId('modal-overlay');
      fireEvent.click(overlay);
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
      localStorage.clear();
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
      expect(localStorage.getItem('theme')).toBe('dark');
      expect(document.cookie).toContain('theme=dark');

      act(() => {
        fireEvent.click(screen.getByText('Set Light'));
      });

      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(localStorage.getItem('theme')).toBe('light');
      expect(document.cookie).toContain('theme=light');
    });

    it('resolves system theme based on media query', () => {
      // Mock dark system theme
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation((query) => ({
          matches: query === '(prefers-color-scheme: dark)',
          media: query,
          onchange: null,
          addListener: jest.fn(),
          removeListener: jest.fn(),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
        })),
      });

      render(
        <ThemeProvider defaultTheme="system">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(screen.getByTestId('current-theme')).toHaveTextContent('system');
      expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
  });
});
