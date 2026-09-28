import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await build({
  absWorkingDir:root,entryPoints:['core/cloud/sdk-entry.js'],outfile:'vendor/supabase.js',
  bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof',
});
console.log('Built local authentication SDK.');
