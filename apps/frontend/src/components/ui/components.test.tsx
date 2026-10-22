import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from './Button';
import { Badge } from './Badge';
import { Card, CardTitle, CardContent } from './Card';

describe('Foundational UI Components', () => {
  describe('Button', () => {
    it('renders with children text and default primary variant', () => {
      render(<Button>Submit Query</Button>);
      const button = screen.getByRole('button', { name: /submit query/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass('bg-brand-primary');
    });

    it('renders secondary variant with appropriate classes', () => {
      render(<Button variant="secondary">Cancel</Button>);
      const button = screen.getByRole('button', { name: /cancel/i });
      expect(button).toHaveClass('bg-surface-elevated');
    });

    it('shows loading state and disables interaction when isLoading is true', () => {
      const handleClick = jest.fn();
      render(
        <Button isLoading onClick={handleClick}>
          Save
        </Button>
      );
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });

    it('handles click events when enabled', () => {
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Click Me</Button>);
      fireEvent.click(screen.getByRole('button', { name: /click me/i }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Badge', () => {
    it('renders badge content with success variant', () => {
      render(<Badge variant="success">READY</Badge>);
      const badge = screen.getByText('READY');
      expect(badge).toBeInTheDocument();
      expect(badge.parentElement).toHaveClass('text-status-success');
    });

    it('renders brand badge variant', () => {
      render(<Badge variant="brand">CONFIDENTIAL</Badge>);
      const badge = screen.getByText('CONFIDENTIAL');
      expect(badge).toBeInTheDocument();
      expect(badge.parentElement).toHaveClass('text-brand-primary');
    });
  });

  describe('Card', () => {
    it('renders card title and content correctly', () => {
      render(
        <Card>
          <CardTitle>Security Overview</CardTitle>
          <CardContent>All systems operational</CardContent>
        </Card>
      );
      expect(screen.getByText('Security Overview')).toBeInTheDocument();
      expect(screen.getByText('All systems operational')).toBeInTheDocument();
    });
  });
});
