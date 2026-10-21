import logo from "@/assets/magalhaes-logo.png";

/** Recorte de apresentação do arquivo original, sem redesenhar a marca. */
export function BrandLogo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <svg
      viewBox={compact ? "408 345 280 190" : "110 345 860 390"}
      role="img"
      aria-label="Magalhães Advocacia e Assessoria Jurídica"
      preserveAspectRatio="xMidYMid meet"
      className={`shrink-0 ${className}`}
    >
      <image href={logo} width="1080" height="1080" />
    </svg>
  );
}
