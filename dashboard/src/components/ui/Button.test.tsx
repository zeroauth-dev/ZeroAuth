import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Modal } from './index';

describe('<Button>', () => {
  it('renders children and triggers onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ship it</Button>);
    const btn = screen.getByRole('button', { name: /ship it/i });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled while loading and shows a spinner', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Saving</Button>);
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the requested variant classes', () => {
    render(<Button variant="danger">Revoke</Button>);
    const btn = screen.getByRole('button', { name: /revoke/i });
    expect(btn.className).toMatch(/bg-\[var\(--color-danger\)\]/);
  });
});

describe('<Modal>', () => {
  it('renders nothing when closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">body</Modal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title + body when open and fires onClose on Escape', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="My modal">body content</Modal>);
    expect(screen.getByRole('dialog', { name: /my modal/i })).toBeInTheDocument();
    expect(screen.getByText(/body content/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
