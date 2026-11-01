import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export const bundledHapiSelection='bundled:hapi';
export function resolveHapiBinary(selection,location=import.meta.url){
 if(selection===bundledHapiSelection)return fileURLToPath(new URL('../../../hapi/hapi',location));
 if(typeof selection!=='string'||!isAbsolute(selection)||/[\u0000-\u001f]/.test(selection))throw Error('Invalid HAPI selection');
 return selection;
}
