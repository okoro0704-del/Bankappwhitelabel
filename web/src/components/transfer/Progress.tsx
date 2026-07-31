import { visualProgressPercent } from '../../transfer/visualProgress';

export function TransferProgressBar({
  status,
  stage,
  label,
}: {
  status: string;
  stage?: number | null;
  label?: string;
}) {
  const percent = visualProgressPercent({ status, stage });

  return (
    <div className="xfer-progress" aria-hidden={false}>
      <div className="xfer-progress-meta">
        <span>{label ?? 'Processing'}</span>
        <span className="muted">{percent}%</span>
      </div>
      <div
        className="xfer-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label ?? 'Transfer progress'}
      >
        <div className="xfer-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function StageCheckpoints({ stage }: { stage: number }) {
  const current = Math.min(4, Math.max(1, stage));
  return (
    <div className="xfer-stages" aria-label={`Verification stage ${current} of 4`}>
      <p className="xfer-stages-label">
        Stage {current} of 4
      </p>
      <div className="xfer-stages-row" aria-hidden>
        {[1, 2, 3, 4].map((n, index) => (
          <div key={n} className="xfer-stages-item">
            <span className={`xfer-stage-dot${n <= current ? ' filled' : ''}`} />
            {index < 3 ? (
              <span className={`xfer-stage-line${n < current ? ' filled' : ''}`} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
