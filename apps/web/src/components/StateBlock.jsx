/**
 * RTC-UI-06 (spec §8): centred empty / error block. Title 16/24 600 in the text colour (not red),
 * body 14/20 muted, optional secondary action. Errors are role=alert, empty states role=status.
 */
export function StateBlock({ title, body, actionLabel, onAction, role = 'status', testId }) {
  return (
    <div className="state-block" role={role} data-testid={testId}>
      <p className="state-title">{title}</p>
      {body && <p className="state-body">{body}</p>}
      {onAction && (
        <button type="button" className="state-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
