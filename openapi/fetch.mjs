// Télécharge la spécification OpenAPI de l'API publique dans openapi/openapi.json.
// Usage : node openapi/fetch.mjs [url]   (défaut : $OPENAPI_URL ou http://localhost:8080/openapi.json)
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const url = process.argv[2] ?? process.env.OPENAPI_URL ?? 'http://localhost:8080/openapi.json'
const target = join(dirname(fileURLToPath(import.meta.url)), 'openapi.json')

let response
try {
  response = await fetch(url)
} catch (err) {
  console.error(`openapi:generate : ${url} injoignable (${err.cause?.code ?? err.message}). L'API est-elle lancée ?`)
  process.exit(1)
}
if (!response.ok) {
  console.error(`openapi:generate : ${url} a répondu ${response.status}`)
  process.exit(1)
}
const spec = await response.json()
if (!spec.openapi || !spec.paths) {
  console.error(`openapi:generate : ${url} ne renvoie pas une spécification OpenAPI`)
  process.exit(1)
}
await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`)
console.log(`openapi:generate : ${Object.keys(spec.paths).length} chemins écrits dans openapi/openapi.json`)
