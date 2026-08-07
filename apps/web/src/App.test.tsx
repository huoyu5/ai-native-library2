import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App (browser seam smoke)', () => {
  it('renders the placeholder page title', () => {
    render(<App />)
    expect(screen.getByText('AI 原生图书管理系统')).toBeTruthy()
  })
})
