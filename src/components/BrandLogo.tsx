import { useId } from "react";
import logo from "@/assets/magalhaes-logo.png";
import goldLogo from "@/assets/magalhaes-logo-gold.png";

/** Recorte de apresentação do arquivo original, sem redesenhar a marca. */
export function BrandLogo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const clipId = useId();
  return (
    <svg
      viewBox={compact ? "408 345 280 190" : "110 345 860 390"}
      role="img"
      aria-label="Magalhães Advocacia e Assessoria Jurídica"
      preserveAspectRatio="xMidYMid meet"
      className={`shrink-0 ${className}`}
    >
      {compact && <defs><clipPath id={clipId}><ellipse cx="548" cy="440" rx="140" ry="94" /></clipPath></defs>}
      <image href={logo} width="1080" height="1080" clipPath={compact ? `url(#${clipId})` : undefined} />
    </svg>
  );
}

/** Logo completo em dourado com fundo transparente (recorte do arquivo original), para superfícies vinho. */
export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <img
      src={goldLogo}
      alt="Magalhães Advocacia e Assessoria Jurídica"
      draggable={false}
      className={`w-auto shrink-0 select-none object-contain ${className}`}
    />
  );
}
