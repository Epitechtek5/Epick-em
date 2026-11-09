import { useEffect } from 'react'

// Pages qui manipulent un jeton reçu par e-mail : aucun en-tête Referer n'est envoyé aux
// autres sites tant que la page est ouverte. nginx pose aussi `Referrer-Policy: no-referrer`
// sur ces routes ; la balise couvre le serveur de dev et la navigation côté client.
export function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}
