import { useEffect } from 'react'

// WCAG 2.4.2 : chaque page a un titre propre.
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Epick'em`
  }, [title])
}
