import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

export function Card({
  children,
  compact = false,
  selected = false,
  interactive = false,
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  compact?: boolean;
  selected?: boolean;
  interactive?: boolean;
}) {
  return (
    <section
      {...props}
      className={`card ui-card${compact ? ' ui-card--compact' : ''}${selected ? ' ui-card--selected' : ''}${interactive ? ' ui-card--interactive' : ''} ${className}`.trim()}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  actions,
  as: Heading = 'h2',
  className = '',
}: {
  title: string;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={`ui-card__header ${className}`.trim()}>
      <Heading>{title}</Heading>
      {actions && <div className="ui-card__header-actions">{actions}</div>}
    </div>
  );
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="ui-card__footer">{children}</div>;
}
