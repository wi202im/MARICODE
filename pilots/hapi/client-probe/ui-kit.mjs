// Web Awesome 3.14 components used by the workspace (pilot: right panel). Vendored, see vendor/LICENSES.txt.
import './vendor/webawesome/components/button/button.js';
import './vendor/webawesome/components/button-group/button-group.js';
import './vendor/webawesome/components/details/details.js';
import './vendor/webawesome/components/icon/icon.js';
import './vendor/webawesome/components/tree/tree.js';
import './vendor/webawesome/components/tree-item/tree-item.js';
// Fixed-version chunk that the package entry re-exports registerIconLibrary from.
import {registerIconLibrary} from './vendor/webawesome/chunks/chunk.UDRJMWVZ.js';

// The default library would fetch Font Awesome from its CDN; point it at the vendored Lucide SVGs instead.
registerIconLibrary('default',{resolver:name=>/^[a-z0-9-]+$/.test(name)?`/vendor/lucide/${name}.svg`:''});
