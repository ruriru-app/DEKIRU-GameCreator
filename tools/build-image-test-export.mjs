// Acceptance artifact only: original fixture pixels, no user materials.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStandaloneHtml,loadTemplateBundle} from '../core/html-exporter.js';
import {fusumaManifest} from '../Typing/templates/fusuma/manifest.js';
import {pngImage} from '../tests/fixtures/question-images.mjs';

const loader={
  loadText:url=>readFile(fileURLToPath(url),'utf8'),
  async loadDataUrl(url){
    const file=fileURLToPath(url),bytes=await readFile(file);
    const mime=path.extname(file)==='.mp3'?'audio/mpeg':'image/png';
    return 'data:'+mime+';base64,'+bytes.toString('base64');
  },
};
const project={schemaVersion:2,title:'画像入り配布テスト',gameType:'typing',templateId:'fusuma',settings:{volume:0,muted:true},questions:[
  {id:'a',prompt:'あを入力',displayAnswer:'亜',reading:'あ',romajiHint:'a',image:{...pngImage,placement:'left'}},
  {id:'i',prompt:'いを入力',displayAnswer:'伊',reading:'い',romajiHint:'i'},
]};
const bundle=await loadTemplateBundle(fusumaManifest,loader);
// Restrict the real exported artifact to embedded resources for this test only.
const csp='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' data:; style-src \'unsafe-inline\' data:; img-src data:; media-src data:; connect-src \'none\'">';
const html=buildStandaloneHtml({project,bundle}).replace('<head>','<head>'+csp);
const output=fileURLToPath(new URL('../dist/typing-fusuma-images-test.html',import.meta.url));
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,html,'utf8');
console.log('Built embedded-only image acceptance artifact ('+Buffer.byteLength(html)+' bytes).');
