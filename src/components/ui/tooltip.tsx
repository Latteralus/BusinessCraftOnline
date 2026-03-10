import type { ReactNode } from "react";

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Tooltip({ content, children, className = "" }: TooltipProps) {
  return (
    <span className={`lc-tooltip ${className}`.trim()}>
      <span className="lc-tooltip-target" tabIndex={0}>
        {children}
      </span>
      <span className="lc-tooltip-bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}

type HelpTooltipProps = {
  content: ReactNode;
  label?: string;
};

export function HelpTooltip({ content, label = "More information" }: HelpTooltipProps) {
  return (
    <Tooltip content={content}>
      <span aria-label={label} className="lc-help-dot" role="img">
        ?
      </span>
    </Tooltip>
  );
}

type TooltipLabelProps = {
  label: ReactNode;
  content: ReactNode;
  className?: string;
};

export function TooltipLabel({ label, content, className = "" }: TooltipLabelProps) {
  return (
    <span className={`lc-tooltip-label ${className}`.trim()}>
      <span>{label}</span>
      <HelpTooltip content={content} />
    </span>
  );
}
