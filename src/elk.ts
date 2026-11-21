// ELK's layout, off the page's thread: it runs in a Web Worker (elk-worker), so laying out a big map never freezes
// scrolling or typing. One worker for every map on the page.
import ElkApi from 'elkjs/lib/elk-api.js'
import workerUrl from 'elkjs/lib/elk-worker.min.js?url'

// elkjs ships CommonJS typed as ESM: under nodenext the default import types as the module, at runtime it is the class
const ELK = ElkApi as unknown as typeof ElkApi.default
export const elk = new ELK({ workerUrl })
