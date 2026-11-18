import { fireEvent, render, screen } from '@testing-library/react'

import { initials } from './initials'
import { UserAvatar } from './UserAvatar'

it('calcule les initiales', () => {
  expect(initials('alice')).toBe('AL')
  expect(initials('jean-paul')).toBe('JP')
  expect(initials('Élodie Martin')).toBe('ÉM')
  expect(initials(' ')).toBe('?')
})

it('affiche la photo, puis les initiales si elle ne se charge pas', () => {
  render(<UserAvatar src="https://img.example/alice.png" name="alice" />)
  const image = screen.getByRole('img', { name: 'alice' })
  expect(image).toHaveAttribute('src', 'https://img.example/alice.png')

  fireEvent.error(image)

  expect(screen.getByRole('img', { name: 'alice' })).toHaveTextContent('AL')
})

it('affiche les initiales sans photo ou avec une URL non http(s)', () => {
  const { rerender } = render(<UserAvatar name="bob" />)
  expect(screen.getByRole('img', { name: 'bob' })).toHaveTextContent('BO')
  rerender(<UserAvatar src="javascript:alert(1)" name="bob" />)
  expect(screen.getByRole('img', { name: 'bob' })).toHaveTextContent('BO')
})
