// Relative specifiers must stay inside their own app, package or test tree; anything else goes through an alias.
const message =
  'Import another app or package through its alias: @daemon/*, @server/*, @desktop/*, @extension/*, @/* (Mini App), @protocol, @protocol/private or @transport/*.';

// `(../)+apps/…`, `(../)+packages/…` from anywhere, and `(../)+<app>/src` from inside apps/<other>.
const crossBoundarySource = String.raw`^(?:\.\./)+(?:(?:apps|packages)/|(?:daemon|server|desktop|mini-app|chrome-extension)/src(?:/|$))`;

export const crossBoundaryImportPatterns = [{ regex: crossBoundarySource, message }];

// esquery regex literals cannot contain `/`, so the selector spells it `\x2F`.
const selectorSource = crossBoundarySource.replaceAll('/', String.raw`\x2F`);
const crossBoundaryLiteral = `Literal[value=/${selectorSource}/]`;

export const crossBoundaryImportSyntax = [
  { selector: `ImportExpression > ${crossBoundaryLiteral}.source`, message },
  { selector: `TSImportType ${crossBoundaryLiteral}`, message },
  {
    selector: `CallExpression[callee.object.name='vi'][callee.property.name=/^(?:mock|doMock|unmock|importActual|importMock)$/] > ${crossBoundaryLiteral}.arguments`,
    message,
  },
];
