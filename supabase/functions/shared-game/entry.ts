import {createSharedGameServer} from './server.js';

// Build index.ts before deployment. Keep credentials in hosted secrets, never here.
Deno.serve(createSharedGameServer({environment:name=>Deno.env.get(name)}));
