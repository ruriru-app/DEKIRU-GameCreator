export const publicConfig = Object.freeze({
  enabled:true,
  supabaseUrl:'https://xrqgsujvduyxtrbegzri.supabase.co',
  publishableKey:'sb_publishable_4I5Vq-KPrENNRPUMRnSOyw_G7-SryKL',
  appBaseUrl:'https://ruriru-app.github.io/DEKIRU-GameCreator/',
  sharedEndpoint:'https://xrqgsujvduyxtrbegzri.supabase.co/functions/v1/shared-game',
});
export function readCloudConfig(value = publicConfig) {
  const keys = ['enabled','supabaseUrl','publishableKey','appBaseUrl','sharedEndpoint'];
  if (!value || Object.keys(value).some(k => !keys.includes(k)) || typeof value.enabled !== 'boolean') throw new Error('Invalid cloud configuration');
  if (value.enabled) {
    const base = new URL(value.appBaseUrl), service = new URL(value.supabaseUrl), endpoint = new URL(value.sharedEndpoint);
    if (base.protocol !== 'https:' || service.protocol !== 'https:' || endpoint.origin !== service.origin ||
        !/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publishableKey) ||
        [base,service,endpoint].some(u=>u.username || u.password || u.search || u.hash) ||
        !base.pathname.endsWith('/') || endpoint.pathname !== '/functions/v1/shared-game') throw new Error('Invalid cloud configuration');
  }
  return Object.freeze({...value});
}
