import {readCloudConfig,publicConfig} from './config.js';
import {createAuth} from './auth.js';
import {createOwnerApi} from './owner-api.js';

/** Local editing remains available if setup, storage or SDK loading fails. */
export async function loadBrowserCloud() {
  let config=publicConfig,client=null,storage;
  try {
    config=readCloudConfig();storage=window.sessionStorage;
    if(config.enabled){
      const {createCloudClient}=await import('../../vendor/supabase.js');
      client=createCloudClient(config,storage);
    }
  }catch{}
  return {configured:Boolean(client),appBaseUrl:config.appBaseUrl,storage,
    auth:createAuth({client,storage,appBaseUrl:config.appBaseUrl}),api:createOwnerApi({client})};
}
