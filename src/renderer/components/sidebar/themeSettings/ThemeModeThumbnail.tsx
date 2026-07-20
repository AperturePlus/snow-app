import { useId } from "react";
import type { ThemeMode } from "./types";

type ThemeModeThumbnailProps = {
  mode: ThemeMode;
};

const LIGHT = {
  bg: "#f8fafc",
  sidebar: "#e2e8f0",
  main: "#ffffff",
  panel: "#f1f5f9",
  border: "#cbd5e1",
} as const;

const DARK = {
  bg: "#0a0a0a",
  sidebar: "#1a1a1a",
  main: "#141414",
  panel: "#111111",
  border: "#2b2b2b",
} as const;

function Thumbnail({ palette }: { palette: typeof LIGHT | typeof DARK }) {
  return (
    <svg
      width="48"
      height="32"
      viewBox="0 0 48 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* App background */}
      <rect
        x="0.5"
        y="0.5"
        width="47"
        height="31"
        rx="3.5"
        fill={palette.bg}
        stroke={palette.border}
      />
      {/* Left sidebar */}
      <rect
        x="4"
        y="4"
        width="10"
        height="24"
        rx="1.5"
        fill={palette.sidebar}
        stroke={palette.border}
        strokeWidth="0.5"
      />
      {/* Main content */}
      <rect
        x="17"
        y="4"
        width="20"
        height="24"
        rx="1.5"
        fill={palette.main}
        stroke={palette.border}
        strokeWidth="0.5"
      />
      {/* Right panel */}
      <rect
        x="40"
        y="4"
        width="4"
        height="24"
        rx="1.5"
        fill={palette.panel}
        stroke={palette.border}
        strokeWidth="0.5"
      />
    </svg>
  );
}

function SystemThumbnail() {
  const id = useId();
  return (
    <svg
      width="48"
      height="32"
      viewBox="0 0 48 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={id}
          x1="0"
          y1="0"
          x2="48"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.5" stopColor={LIGHT.bg} />
          <stop offset="0.5" stopColor={DARK.bg} />
        </linearGradient>
        <linearGradient
          id={`${id}-sidebar`}
          x1="0"
          y1="0"
          x2="48"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.5" stopColor={LIGHT.sidebar} />
          <stop offset="0.5" stopColor={DARK.sidebar} />
        </linearGradient>
        <linearGradient
          id={`${id}-main`}
          x1="0"
          y1="0"
          x2="48"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.5" stopColor={LIGHT.main} />
          <stop offset="0.5" stopColor={DARK.main} />
        </linearGradient>
        <linearGradient
          id={`${id}-panel`}
          x1="0"
          y1="0"
          x2="48"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.5" stopColor={LIGHT.panel} />
          <stop offset="0.5" stopColor={DARK.panel} />
        </linearGradient>
        <linearGradient
          id={`${id}-border`}
          x1="0"
          y1="0"
          x2="48"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.5" stopColor={LIGHT.border} />
          <stop offset="0.5" stopColor={DARK.border} />
        </linearGradient>
      </defs>
      {/* App background */}
      <rect
        x="0.5"
        y="0.5"
        width="47"
        height="31"
        rx="3.5"
        fill={`url(#${id})`}
        stroke={`url(#${id}-border)`}
      />
      {/* Left sidebar */}
      <rect
        x="4"
        y="4"
        width="10"
        height="24"
        rx="1.5"
        fill={`url(#${id}-sidebar)`}
        stroke={`url(#${id}-border)`}
        strokeWidth="0.5"
      />
      {/* Main content */}
      <rect
        x="17"
        y="4"
        width="20"
        height="24"
        rx="1.5"
        fill={`url(#${id}-main)`}
        stroke={`url(#${id}-border)`}
        strokeWidth="0.5"
      />
      {/* Right panel */}
      <rect
        x="40"
        y="4"
        width="4"
        height="24"
        rx="1.5"
        fill={`url(#${id}-panel)`}
        stroke={`url(#${id}-border)`}
        strokeWidth="0.5"
      />
    </svg>
  );
}

export function ThemeModeThumbnail({ mode }: ThemeModeThumbnailProps) {
  if (mode === "system") {
    return <SystemThumbnail />;
  }
  return <Thumbnail palette={mode === "light" ? LIGHT : DARK} />;
}
