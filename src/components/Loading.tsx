// Estados de carga de las islas React: spinner con texto y tarjetas fantasma (skeleton) con la forma de los resultados.
// Los estilos (.spinner, .skeleton) viven en global.css.

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spinner ${className}`} aria-hidden="true" />;
}

/** Spinner + texto, anunciado a lectores de pantalla. */
export function LoadingState({ label = 'Cargando…', className = '' }: { label?: string; className?: string }) {
  return (
    <p role="status" className={`flex items-center justify-center gap-2.5 py-10 text-muted ${className}`}>
      <Spinner className="h-5 w-5 text-brand-600" />
      {label}
    </p>
  );
}

/** Rejilla de tarjetas fantasma con la misma forma que ListingCard/BusinessCard. */
export function CardsSkeleton({ count = 4, label = 'Cargando…', className = '' }: { count?: number; label?: string; className?: string }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton aspect-[4/3] rounded-none" />
            <div className="space-y-2 p-4">
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-5 w-1/2" />
              <div className="skeleton h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Filas fantasma para tablas y listas (panel, administración). */
export function RowsSkeleton({ rows = 4, label = 'Cargando…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card flex items-center gap-3 p-4" aria-hidden="true">
          <div className="skeleton h-12 w-12 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
