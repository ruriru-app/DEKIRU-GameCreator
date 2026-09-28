import {createClient} from '@supabase/supabase-js';
export function createCloudClient(config,sessionStorage) {
  return createClient(config.supabaseUrl,config.publishableKey,{
    auth:{
      flowType:'pkce',storage:sessionStorage,storageKey:'dekiru-gamecreator.auth.v1',
      persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,
    },
  });
}
