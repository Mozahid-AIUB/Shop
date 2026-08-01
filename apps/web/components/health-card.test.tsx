import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthCard } from './health-card';

describe('HealthCard', () => {
  it('shows the API as connected when the database is up', () => {
    render(
      <HealthCard
        health={{ status: 'ok', db: 'up', uptime: 42, timestamp: '2026-08-01T12:00:00.000Z' }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('API connected');
    expect(screen.getByText(/database: up/i)).toBeInTheDocument();
  });

  it('shows the database as down when the api reports an error', () => {
    render(
      <HealthCard
        health={{ status: 'error', db: 'down', uptime: 42, timestamp: '2026-08-01T12:00:00.000Z' }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('API degraded');
    expect(screen.getByText(/database: down/i)).toBeInTheDocument();
  });

  // API একেবারে বন্ধ থাকলে fetch null দেয় — পেজ ক্র্যাশ করা যাবে না
  it('shows an unreachable message when there is no health payload', () => {
    render(<HealthCard health={null} />);

    expect(screen.getByRole('status')).toHaveTextContent('API unreachable');
  });
});
