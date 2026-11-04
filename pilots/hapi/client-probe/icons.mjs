// VS Code Codicons (vendor/codicons, font CC BY 4.0). icon('close') -> <span class="codicon codicon-close glyph">.
export function icon(name,doc=globalThis.document){
 const n=doc.createElement('span');n.className=`codicon codicon-${name} glyph`;n.setAttribute('aria-hidden','true');return n;
}
