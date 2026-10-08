interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_ADS?: string;
  readonly PUBLIC_ADSENSE_CLIENT?: string;
  readonly PUBLIC_ADSENSE_SLOT?: string;
  readonly PUBLIC_PLAUSIBLE_DOMAIN?: string;
  readonly PUBLIC_GEOCODER?: string;
  readonly PUBLIC_MAPTILER_KEY?: string;
  readonly PUBLIC_GEOAPIFY_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
