import React from 'react';

export type ResultCardVariant = 'correct' | 'wrong' | 'trashTalk' | 'commentary';

interface ResultCardProps {
  variant: ResultCardVariant;
  label?: React.ReactNode;
  title?: React.ReactNode;
  body: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  className?: string;
}

export const ResultCard: React.FC<ResultCardProps> = ({
  variant,
  label,
  title,
  body,
  actionLabel,
  onAction,
  actionDisabled = false,
  className = '',
}) => {
  const hasAction = !!actionLabel && !!onAction;

  return (
    <div className={`result-card result-card--${variant} ${className}`.trim()}>
      {label ? <p className="result-card__label">{label}</p> : null}
      {title ? <h3 className="result-card__title">{title}</h3> : null}
      <div className="result-card__body">{body}</div>
      {hasAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="result-card__button"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
