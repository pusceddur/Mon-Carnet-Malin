import type { JSX, ReactNode } from 'react';

// Line icons drawn on a 24px grid, one stroke weight, inheriting currentColor.

export interface IconProps {
  /** Size in px (default 24). */
  size?: number;
  className?: string;
}

function Svg({ size = 24, className, children }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function BackspaceIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
      <path d="m16.5 9.5-5 5" />
      <path d="m11.5 9.5 5 5" />
    </Svg>
  );
}

export function MinusIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function CloudOffIcon(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8.5 6.2A6 6 0 0 1 17.4 10H18a4 4 0 0 1 2.9 6.8" />
      <path d="M17 19H7a5 5 0 0 1-1.6-9.7" />
      <path d="m3 3 18 18" />
    </Svg>
  );
}
