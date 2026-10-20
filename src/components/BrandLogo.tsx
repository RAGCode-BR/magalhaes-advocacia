import logo from "@/assets/magalhaes-logo.png";

/** Recorte de apresentação do arquivo original, sem redesenhar a marca. */
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="100 325 880 430"
      role="img"
      aria-label="Magalhães Advocacia e Assessoria Jurídica"
      className={className}
    >
      <image href={logo} width="1080" height="1080" />
    </svg>
  );
}
