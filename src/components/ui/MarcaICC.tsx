type MarcaICCProps = {
  subtitulo?: string;
  tamano?: 'compacto' | 'grande';
};

/** Logo oficial de Iglesia Casa del Alfarero + nombre ICCReservas. */
export function MarcaICC({ subtitulo, tamano = 'compacto' }: MarcaICCProps) {
  const esGrande = tamano === 'grande';
  return (
    <div className={`flex items-center ${esGrande ? 'gap-3.5' : 'gap-2.5'}`}>
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-acento/40 bg-texto/95 shadow-sm ${
          esGrande ? 'size-14 p-1.5' : 'size-9 p-1'
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- asset local ligero en public/ sin overhead de optimizador */}
        <img
          src="/logo-icc.png"
          alt="Logo Iglesia Casa del Alfarero"
          className="size-full object-contain"
        />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={`font-titulo leading-tight text-texto ${esGrande ? 'text-2xl font-bold' : 'text-lg font-semibold'}`}>
          ICCReservas
        </span>
        {subtitulo && (
          <span className={`${esGrande ? 'text-xs' : 'text-[11px]'} font-semibold uppercase tracking-wider text-acento`}>
            {subtitulo}
          </span>
        )}
      </span>
    </div>
  );
}
