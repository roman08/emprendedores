// Insignia de negocio verificado (mismo dibujo que VerifiedBadge.astro) para las islas de React.
interface Props { size?: number; className?: string; label?: string }

export default function VerifiedBadge({ size = 20, className = '', label = 'Negocio verificado' }: Readonly<Props>) {
  return (
    <span className={`inline-flex shrink-0 align-[-0.2em] ${className}`} title={label} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M12 2 20 5v6c0 4.800-3.200 8.800-8 11-4.800-2.200-8-6.200-8-11V5z" className="fill-brand-600" />
        <path d="M12 2 20 5v6c0 4.800-3.200 8.800-8 11V2z" fill="#fff" fillOpacity="0.14" />
        <path d="m8.200 12.300 2.600 2.600 5-5.400" stroke="#fff" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
