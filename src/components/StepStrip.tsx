interface Props {
  hasResult: boolean;
  running: boolean;
  pending: number;
  onReview: () => void;
  onExport: () => void;
}

type State = "done" | "active" | "todo";

export default function StepStrip({ hasResult, running, pending, onReview, onExport }: Props) {
  const upload: State = hasResult || running ? "done" : "active";
  const match: State = hasResult ? "done" : running ? "active" : "todo";
  const review: State = !hasResult ? "todo" : pending > 0 ? "active" : "done";
  const exportS: State = !hasResult ? "todo" : pending > 0 ? "todo" : "active";

  const steps: { n: number; label: string; note: string; state: State; onClick?: () => void }[] = [
    { n: 1, label: "Upload", note: "CPSE material files", state: upload },
    { n: 2, label: "Match", note: "Rules + local AI", state: match },
    { n: 3, label: "Review", note: hasResult ? `${pending.toLocaleString()} pending` : "Human sign-off", state: review, onClick: hasResult ? onReview : undefined },
    { n: 4, label: "Export", note: "Migration mapping", state: exportS, onClick: hasResult ? onExport : undefined },
  ];

  return (
    <ol className="steps" aria-label="Workflow">
      {steps.map((s) => (
        <li key={s.n} className={`step ${s.state}`} aria-current={s.state === "active" ? "step" : undefined}>
          <button type="button" className="step-btn" disabled={!s.onClick} onClick={s.onClick}>
            <span className="step-num">{s.state === "done" ? "✓" : s.n}</span>
            <span className="step-text"><b>{s.label}</b><small>{s.note}</small></span>
          </button>
        </li>
      ))}
    </ol>
  );
}
